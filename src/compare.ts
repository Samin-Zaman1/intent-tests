import * as fs from 'fs';
import * as path from 'path';
import { analyzeSource } from './analysis/analyze';
import { FileBehaviorDiff, diffAnalyses } from './analysis/diff';
import { SourceText } from './analysis/project';
import { isTestFile } from './analysis/tests';
import { Base, changedFiles, fileAt, repoRoot, resolveBase } from './git';
import { Projects, fileKey } from './project';

const SOURCE_FILE = /\.[cm]?[jt]sx?$/;
const DECLARATION_FILE = /\.d\.[cm]?ts$/;

export interface FileDiff extends FileBehaviorDiff {
  /** Relative to the repo root, with forward slashes. */
  file: string;
}

export interface BehaviorComparison {
  root: string;
  base: Base;
  files: FileDiff[];
  testFilesChanged: string[];
}

/** Compares the behaviors of every changed source file in the working tree against a git ref. */
export async function compareBehaviors(
  cwd: string,
  baseSpec: string,
  options: { overlay?: Map<string, SourceText>; projects?: Projects } = {},
): Promise<BehaviorComparison> {
  const root = await repoRoot(cwd);
  if (!root) throw new Error('Not inside a git repository.');
  const base = await resolveBase(root, baseSpec);
  if (!base) throw new Error(baseSpec === 'branch' ? 'Could not find main or master to compare with.' : `Could not find git ref "${baseSpec}".`);

  const overlay = options.overlay ?? new Map<string, SourceText>();
  const projects = options.projects ?? new Projects();
  const changed = (await changedFiles(root, base.ref)).filter((f) => SOURCE_FILE.test(f) && !DECLARATION_FILE.test(f));
  const testFilesChanged = changed.filter(isTestFile);

  const files: FileDiff[] = [];
  for (const file of changed.filter((f) => !isTestFile(f))) {
    const absolute = path.join(root, file);
    const beforeText = await fileAt(root, base.ref, file);
    const afterText = overlay.get(fileKey(absolute))?.text ?? readIfExists(absolute);
    const diff = diffAnalyses(
      beforeText === undefined ? [] : analyzeSource(absolute, beforeText),
      afterText === undefined ? [] : analyzeSource(absolute, afterText),
    );
    if (!diff.functions.length && !diff.editedWithoutBehaviorChange.length) continue;
    if (afterText !== undefined) findTests(diff, absolute, root, projects, overlay, testFilesChanged);
    files.push({ file, ...diff });
  }
  return { root, base, files, testFilesChanged };
}

function findTests(
  diff: FileBehaviorDiff,
  absolute: string,
  root: string,
  projects: Projects,
  overlay: Map<string, SourceText>,
  testFilesChanged: string[],
): void {
  const project = projects.forFile(absolute, root);
  for (const fn of diff.functions) {
    if (!fn.after) continue;
    try {
      const tests = project.testsReaching(absolute, fn.after.namePos, overlay);
      const files = [...new Set(tests.map((t) => path.relative(root, t.site.fileName).split(path.sep).join('/')))];
      fn.tests = {
        count: tests.length,
        direct: tests.filter((t) => !t.via.length).length,
        files,
        touched: files.some((f) => testFilesChanged.includes(f)),
        via: tests.find((t) => t.via.length)?.via,
      };
    } catch (error) {
      console.error(`Intent Tests: could not look up tests for ${fn.name}`, error);
    }
  }
}

function readIfExists(file: string): string | undefined {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
}
