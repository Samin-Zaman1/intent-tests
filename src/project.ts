import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { CallSite, findCallSites } from './analysis/callers';
import { ProjectHost, SourceText, createLanguageService } from './analysis/project';
import { isTestFile } from './analysis/tests';

export interface ReachingTest {
  site: CallSite;
  /** Functions between the test and the target, outermost first; empty when the test calls it directly. */
  via: string[];
}

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];
const EXCLUDE = ['**/node_modules', '**/out', '**/dist', '**/build', '**/coverage', '**/.git'];

function normalize(fileName: string): string {
  return fileName.replace(/\\/g, '/');
}

export function fileKey(fileName: string): string {
  const name = normalize(path.resolve(fileName));
  return ts.sys.useCaseSensitiveFileNames ? name : name.toLowerCase();
}

/** A TypeScript project on disk, with unsaved editor contents layered on top. Test files are always included. */
export class Project implements ProjectHost {
  readonly service: ts.LanguageService;
  readonly testFiles: string[];
  private readonly files = new Map<string, string>();
  private readonly disk = new Map<string, { mtime: number; text: string }>();
  private overlay = new Map<string, SourceText>();

  constructor(readonly root: string, readonly compilerOptions: ts.CompilerOptions, configFiles: string[]) {
    const all = ts.sys
      .readDirectory(root, SOURCE_EXTENSIONS, EXCLUDE, ['**/*'])
      .filter((file) => !/\.d\.[cm]?ts$/.test(file));
    this.testFiles = all.filter(isTestFile);
    // Without a config, take every source file; test files are often excluded from tsconfig, so add them anyway.
    for (const file of [...(configFiles.length ? configFiles : all), ...this.testFiles]) this.add(file);
    this.service = createLanguageService(this);
  }

  rootFiles(): string[] {
    return [...this.files.values()];
  }

  read(fileName: string): SourceText | undefined {
    const key = fileKey(fileName);
    const open = this.overlay.get(key);
    if (open) return open;
    try {
      const mtime = fs.statSync(fileName).mtimeMs;
      const cached = this.disk.get(key);
      if (cached?.mtime === mtime) return { version: String(mtime), text: cached.text };
      const text = fs.readFileSync(fileName, 'utf8');
      this.disk.set(key, { mtime, text });
      return { version: String(mtime), text };
    } catch {
      return undefined;
    }
  }

  /** Every call to the function named at `position`, in source and test files. */
  callersOf(fileName: string, position: number, overlay: Map<string, SourceText>): CallSite[] {
    this.overlay = overlay;
    this.add(fileName);
    return findCallSites(this.service, normalize(fileName), position);
  }

  /**
   * Tests that call the function directly or through a chain of callers, breadth first so each test is
   * reported with its shortest chain. `budget` caps reference lookups so large codebases stay fast.
   */
  testsReaching(
    fileName: string,
    position: number,
    overlay: Map<string, SourceText>,
    { maxDepth = 3, budget = 40 } = {},
  ): ReachingTest[] {
    this.overlay = overlay;
    this.add(fileName);
    const found = new Map<string, ReachingTest>();
    const searched = new Set<string>();
    let frontier = [{ fileName: normalize(fileName), position, via: [] as string[] }];
    for (let depth = 0; depth <= maxDepth && frontier.length; depth++) {
      const next: typeof frontier = [];
      for (const target of frontier) {
        const key = `${fileKey(target.fileName)}:${target.position}`;
        if (searched.has(key) || searched.size >= budget) continue;
        searched.add(key);
        for (const site of findCallSites(this.service, target.fileName, target.position)) {
          const siteKey = `${fileKey(site.fileName)}:${site.line}`;
          if (site.isTest) {
            if (!found.has(siteKey)) found.set(siteKey, { site, via: target.via });
          } else if (site.enclosing) {
            next.push({ fileName: site.fileName, position: site.enclosing.pos, via: [site.enclosing.name, ...target.via] });
          }
        }
      }
      frontier = next;
    }
    return [...found.values()];
  }

  private add(fileName: string): void {
    const key = fileKey(fileName);
    if (!this.files.has(key)) this.files.set(key, normalize(fileName));
  }
}

/** One project per tsconfig/jsconfig, or per workspace folder when there is none. Built lazily, on first use. */
export class Projects {
  private readonly projects = new Map<string, Project>();

  forFile(fileName: string, fallbackRoot: string): Project {
    const dir = path.dirname(fileName);
    const configPath =
      ts.findConfigFile(dir, ts.sys.fileExists, 'tsconfig.json') ?? ts.findConfigFile(dir, ts.sys.fileExists, 'jsconfig.json');
    const key = configPath ?? fallbackRoot;
    let project = this.projects.get(key);
    if (!project) {
      project = configPath ? fromConfig(configPath) : fromFolder(fallbackRoot);
      this.projects.set(key, project);
    }
    return project;
  }

  clear(): void {
    this.projects.forEach((project) => project.service.dispose());
    this.projects.clear();
  }
}

function fromConfig(configPath: string): Project {
  const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} });
  const options = { ...(parsed?.options ?? {}), allowJs: true, noEmit: true };
  return new Project(path.dirname(configPath), options, parsed?.fileNames ?? []);
}

function fromFolder(root: string): Project {
  return new Project(
    root,
    {
      allowJs: true,
      noEmit: true,
      target: ts.ScriptTarget.Latest,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      jsx: ts.JsxEmit.Preserve,
    },
    [],
  );
}
