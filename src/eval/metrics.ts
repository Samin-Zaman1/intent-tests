import { BehaviorChange, describeBehavior, shape } from '../analysis/diff';
import { isTestFile } from '../analysis/tests';

/** Subjects of commits that likely fix a bug, including conventional-commit `fix(scope):` prefixes. */
export const FIX_SUBJECT = /^(fix|bugfix|hotfix)(\(.+?\))?!?:|\bfix(es|ed)?\b|\bbugs?\b|off[- ]by[- ]one|boundary|edge case/i;

const SOURCE_FILE = /\.[cm]?[jt]sx?$/;
const DECLARATION_FILE = /\.d\.[cm]?ts$/;
const NOT_SOURCE = /(^|\/)(node_modules|dist|build|docs?|examples?|benchmarks?|scripts|playground|e2e|fixtures?)\//;

export interface FileStat {
  file: string;
  added: number;
  removed: number;
}

export function isEvaluatedSource(file: string): boolean {
  return SOURCE_FILE.test(file) && !DECLARATION_FILE.test(file) && !isTestFile(file) && !NOT_SOURCE.test(file);
}

/** A small fix: 1–4 source files and at most `maxLines` changed lines in them. */
export function smallFix(stats: FileStat[], maxLines = 60): { sourceFiles: number; linesChanged: number } | undefined {
  const source = stats.filter((s) => isEvaluatedSource(s.file));
  const linesChanged = source.reduce((n, s) => n + s.added + s.removed, 0);
  if (source.length < 1 || source.length > 4 || linesChanged > maxLines) return undefined;
  return { sourceFiles: source.length, linesChanged };
}

export { shape };

/** A change whose before and after differ only in names: often a rename, sometimes a different variable checked. */
export function isIdentifierOnly(change: BehaviorChange): boolean {
  if (change.kind === 'steps-changed') return shape(change.removedSteps.join(';')) === shape(change.addedSteps.join(';'));
  if (change.kind !== 'outcome-changed' && change.kind !== 'conditions-changed') return false;
  return shape(describeBehavior(change.before)) === shape(describeBehavior(change.after));
}
