import * as path from 'path';
import * as vscode from 'vscode';
import { FunctionAnalysis, analyzeSource } from './analysis/analyze';
import { SourceText } from './analysis/project';
import { closestTestFile } from './analysis/tests';
import { compareBehaviors } from './compare';
import { renderComparison } from './diffReport';
import { gitContext } from './git';
import { Projects, fileKey } from './project';
import { ReportContext, renderReport } from './report';

const SELECTOR: vscode.DocumentSelector = ['typescript', 'typescriptreact', 'javascript', 'javascriptreact'].map(
  (language) => ({ language, scheme: 'file' }),
);

const cache = new Map<string, { version: number; analysis: FunctionAnalysis[] }>();
const projects = new Projects();

function analysisFor(doc: vscode.TextDocument): FunctionAnalysis[] {
  const key = doc.uri.toString();
  const hit = cache.get(key);
  if (hit && hit.version === doc.version) return hit.analysis;
  const analysis = analyzeSource(doc.fileName, doc.getText());
  cache.set(key, { version: doc.version, analysis });
  return analysis;
}

function config() {
  return vscode.workspace.getConfiguration('intentTests');
}

/**
 * Shows "N behaviors" above functions. While the file has unsaved edits it keeps showing the counts from the
 * last save, so nothing appears, disappears or shifts the code while the developer is typing.
 */
class BehaviorLensProvider implements vscode.CodeLensProvider {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.changed.event;
  private readonly saved = new Map<string, FunctionAnalysis[]>();

  snapshot(doc: vscode.TextDocument): void {
    if (!doc.isDirty) this.saved.set(doc.uri.toString(), analysisFor(doc));
    this.changed.fire();
  }

  forget(doc: vscode.TextDocument): void {
    this.saved.delete(doc.uri.toString());
    cache.delete(doc.uri.toString());
  }

  provideCodeLenses(doc: vscode.TextDocument): vscode.CodeLens[] {
    const saved = this.saved.get(doc.uri.toString());
    if (!saved) return [];
    const savedByName = new Map(saved.map((fn) => [fn.name, fn]));
    const minBehaviors = config().get<number>('minBehaviors', 2);
    const lenses: vscode.CodeLens[] = [];
    for (const fn of analysisFor(doc)) {
      const shown = savedByName.get(fn.name);
      // Nested functions are part of their parent's label; a label on every callback would be noise.
      if (!shown || fn.parent || (shown.behaviors.length < minBehaviors && !shown.mismatches.length)) continue;
      const title =
        `${shown.behaviors.length} behaviors` +
        (shown.mismatches.length ? ` · ⚠ ${shown.mismatches.length} possible mismatch` : '');
      lenses.push(
        new vscode.CodeLens(new vscode.Range(fn.line, 0, fn.line, 0), {
          title,
          command: 'intentTests.showBehaviors',
          arguments: [doc.uri, fn.line],
        }),
      );
    }
    return lenses;
  }
}

function updateDiagnostics(doc: vscode.TextDocument, collection: vscode.DiagnosticCollection): void {
  if (!config().get<boolean>('mismatchWarnings', true)) {
    collection.delete(doc.uri);
    return;
  }
  const diagnostics = analysisFor(doc).flatMap((fn) =>
    fn.mismatches.map((m) => {
      const line = doc.lineAt(m.line);
      const range = new vscode.Range(m.line, line.firstNonWhitespaceCharacterIndex, m.line, line.text.length);
      const diagnostic = new vscode.Diagnostic(range, m.explanation, vscode.DiagnosticSeverity.Information);
      diagnostic.source = 'Intent Tests';
      return diagnostic;
    }),
  );
  collection.set(doc.uri, diagnostics);
}

async function showBehaviors(uri: vscode.Uri, line: number): Promise<void> {
  const doc = await vscode.workspace.openTextDocument(uri);
  const fn = analysisFor(doc).find((f) => f.line === line);
  if (!fn) return;
  const ctx: ReportContext = { file: vscode.workspace.asRelativePath(uri), git: await gitContext(uri.fsPath) };
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title: 'Intent Tests: finding callers and tests' },
    async () => {
      try {
        const root = vscode.workspace.getWorkspaceFolder(uri)?.uri.fsPath ?? path.dirname(doc.fileName);
        const project = projects.forFile(doc.fileName, root);
        ctx.callers = project
          .callersOf(doc.fileName, fn.namePos, unsavedDocuments())
          .map((c) => ({ ...c, fileName: vscode.workspace.asRelativePath(c.fileName) }));
        const closest = closestTestFile(doc.fileName, project.testFiles);
        ctx.closestTest = closest && vscode.workspace.asRelativePath(closest);
      } catch (error) {
        console.error('Intent Tests: caller lookup failed', error);
      }
    },
  );
  const report = await vscode.workspace.openTextDocument({ language: 'markdown', content: renderReport(fn, ctx) });
  await vscode.window.showTextDocument(report, { viewColumn: vscode.ViewColumn.Beside, preview: true, preserveFocus: true });
}

async function compareBehaviorsCommand(): Promise<void> {
  const active = vscode.window.activeTextEditor?.document.uri;
  const folder = (active && vscode.workspace.getWorkspaceFolder(active)) ?? vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    vscode.window.showWarningMessage('Intent Tests: open a folder inside a git repository first.');
    return;
  }
  const choice = await vscode.window.showQuickPick(
    [
      { label: 'Uncommitted changes', description: 'compared with the last commit', base: 'HEAD' },
      { label: 'This branch', description: 'compared with where it left main', base: 'branch' },
      { label: 'Another git ref…', description: 'a commit, branch or tag', base: '' },
    ],
    { placeHolder: 'Which changes should be compared?' },
  );
  if (!choice) return;
  const base = choice.base || (await vscode.window.showInputBox({ prompt: 'Git ref to compare with', placeHolder: 'main, HEAD~3, v1.2.0' }))?.trim();
  if (!base) return;

  try {
    const comparison = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: 'Intent Tests: comparing behaviors' },
      () => compareBehaviors(folder.uri.fsPath, base, { overlay: unsavedDocuments(), projects }),
    );
    const report = await vscode.workspace.openTextDocument({ language: 'markdown', content: renderComparison(comparison) });
    await vscode.window.showTextDocument(report, { preview: true });
  } catch (error) {
    vscode.window.showErrorMessage(`Intent Tests: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function unsavedDocuments(): Map<string, SourceText> {
  return new Map(
    vscode.workspace.textDocuments
      .filter((d) => d.isDirty && d.uri.scheme === 'file')
      .map((d) => [fileKey(d.fileName), { version: `editor:${d.version}`, text: d.getText() }]),
  );
}

export function activate(context: vscode.ExtensionContext): void {
  const diagnostics = vscode.languages.createDiagnosticCollection('intentTests');
  const lenses = new BehaviorLensProvider();

  // Analysis results only change on open and save, never on keystrokes.
  const refresh = (doc: vscode.TextDocument) => {
    if (!vscode.languages.match(SELECTOR, doc)) return;
    updateDiagnostics(doc, diagnostics);
    lenses.snapshot(doc);
  };

  context.subscriptions.push(
    diagnostics,
    vscode.languages.registerCodeLensProvider(SELECTOR, lenses),
    vscode.commands.registerCommand('intentTests.showBehaviors', showBehaviors),
    vscode.commands.registerCommand('intentTests.compareBehaviors', compareBehaviorsCommand),
    vscode.workspace.onDidOpenTextDocument(refresh),
    vscode.workspace.onDidSaveTextDocument(refresh),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      diagnostics.delete(doc.uri);
      lenses.forget(doc);
    }),
    // Project file lists are read once; rebuild them when files come and go.
    vscode.workspace.onDidCreateFiles(() => projects.clear()),
    vscode.workspace.onDidDeleteFiles(() => projects.clear()),
    vscode.workspace.onDidRenameFiles(() => projects.clear()),
    { dispose: () => projects.clear() },
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('intentTests')) vscode.workspace.textDocuments.forEach(refresh);
    }),
  );
  vscode.workspace.textDocuments.forEach(refresh);
}

export function deactivate(): void {}
