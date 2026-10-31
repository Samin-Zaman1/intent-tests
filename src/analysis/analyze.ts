import { FunctionInfo, TopLevelValue, findFunctions, findTopLevelValues, parse } from './behaviors';
import { Mismatch, findMismatches } from './mismatch';

export interface FunctionAnalysis extends FunctionInfo {
  mismatches: Mismatch[];
}

export interface FileAnalysis {
  functions: FunctionAnalysis[];
  values: TopLevelValue[];
}

export function analyzeFile(fileName: string, text: string): FileAnalysis {
  const sf = parse(fileName, text);
  return {
    functions: findFunctions(sf).map((fn) => ({ ...fn, mismatches: findMismatches(fn) })),
    values: findTopLevelValues(sf),
  };
}

export function analyzeSource(fileName: string, text: string): FunctionAnalysis[] {
  return analyzeFile(fileName, text).functions;
}
