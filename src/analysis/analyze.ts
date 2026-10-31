import { FunctionInfo, findFunctions, parse } from './behaviors';
import { Mismatch, findMismatches } from './mismatch';

export interface FunctionAnalysis extends FunctionInfo {
  mismatches: Mismatch[];
}

export function analyzeSource(fileName: string, text: string): FunctionAnalysis[] {
  return findFunctions(parse(fileName, text)).map((fn) => ({ ...fn, mismatches: findMismatches(fn) }));
}
