import * as ts from 'typescript';

export interface SourceText {
  version: string;
  text: string;
}

export interface ProjectHost {
  root: string;
  compilerOptions: ts.CompilerOptions;
  rootFiles(): string[];
  /** Contents of any file the compiler asks for, including lib files; undefined if it does not exist. */
  read(fileName: string): SourceText | undefined;
  /** Defaults to the real file system; module resolution skips folders this says are missing. */
  directoryExists?(dirName: string): boolean;
}

export function createLanguageService(host: ProjectHost): ts.LanguageService {
  const serviceHost: ts.LanguageServiceHost = {
    getCompilationSettings: () => host.compilerOptions,
    getScriptFileNames: () => host.rootFiles(),
    getScriptVersion: (fileName) => host.read(fileName)?.version ?? '0',
    getScriptSnapshot: (fileName) => {
      const source = host.read(fileName);
      return source && ts.ScriptSnapshot.fromString(source.text);
    },
    getCurrentDirectory: () => host.root,
    getDefaultLibFileName: ts.getDefaultLibFilePath,
    useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
    fileExists: (fileName) => host.read(fileName) !== undefined,
    readFile: (fileName) => host.read(fileName)?.text,
    readDirectory: ts.sys.readDirectory,
    directoryExists: (dirName) => host.directoryExists?.(dirName) ?? ts.sys.directoryExists(dirName),
    getDirectories: ts.sys.getDirectories,
  };
  return ts.createLanguageService(serviceHost, ts.createDocumentRegistry());
}
