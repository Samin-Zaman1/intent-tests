import * as fs from 'fs';
import * as path from 'path';
import { FunctionAnalysis, analyzeFile } from '../analysis/analyze';
import { Behavior } from '../analysis/behaviors';
import { FunctionDiff } from '../analysis/diff';
import { SourceText } from '../analysis/project';
import { BehaviorComparison, compareBehaviors } from '../compare';
import { repoRoot } from '../git';
import { Projects, fileKey } from '../project';
import { Plan, PlanItem, closestBehavior, itemMatches, parsePlan } from './plan';

export const DEFAULT_PLAN = '.intent/plan.md';

export type ItemStatus =
  /** A behavior matching the item exists. */
  | 'found'
  /** No behavior matches the item. */
  | 'missing'
  /** A `Not:` item that a behavior matches. */
  | 'violated'
  /** A `Not:` item that nothing matches. */
  | 'absent';

export interface ItemResult {
  item: PlanItem;
  status: ItemStatus;
  /** The matching behaviors, or for a missing item the closest one. */
  behaviors: Behavior[];
}

export interface SectionResult {
  functionName: string;
  file?: string;
  /** False when the function could not be found in the file. */
  found: boolean;
  items: ItemResult[];
  /** Behaviors added or changed since the base that no item describes, and removed ones no `Not:` item asked for. */
  unplanned: { change: 'added' | 'changed' | 'removed'; behavior: Behavior }[];
  tests?: FunctionDiff['tests'];
}

export interface PlanCheck {
  plan: Plan;
  planFile: string;
  base: BehaviorComparison['base'];
  sections: SectionResult[];
  /** Functions whose behavior changed since the base but that the plan does not mention. */
  unplannedFunctions: { file: string; name: string; changes: number }[];
  /** True when every planned behavior exists, no `Not:` item is violated, and every planned function was found. */
  passed: boolean;
}

export async function checkPlan(
  cwd: string,
  planFile = DEFAULT_PLAN,
  options: { base?: string; overlay?: Map<string, SourceText>; projects?: Projects } = {},
): Promise<PlanCheck> {
  const root = (await repoRoot(cwd)) ?? cwd;
  const planPath = path.resolve(root, planFile);
  if (!fs.existsSync(planPath)) throw new Error(`No plan at ${planFile}. Start one with: intent-tests plan <file> [function]`);
  const plan = parsePlan(fs.readFileSync(planPath, 'utf8'));
  const overlay = options.overlay ?? new Map<string, SourceText>();
  const comparison = await compareBehaviors(root, options.base ?? 'HEAD', { overlay, projects: options.projects });

  const diffs = new Map<string, FunctionDiff>();
  for (const file of comparison.files) for (const fn of file.functions) diffs.set(`${file.file}#${fn.name}`, fn);

  const sections: SectionResult[] = [];
  for (const section of plan.sections) {
    const file = section.file ?? findFile(comparison, section.functionName);
    const fn = file ? findFunction(root, file, section.functionName, overlay) : undefined;
    const diff = file ? diffs.get(`${file}#${section.functionName}`) : undefined;
    if (!fn) {
      sections.push({ functionName: section.functionName, file, found: false, items: [], unplanned: [] });
      continue;
    }
    const items = section.items.map((item): ItemResult => {
      const matched = fn.behaviors.filter((b) => itemMatches(item, b));
      if (item.negated) return { item, status: matched.length ? 'violated' : 'absent', behaviors: matched };
      if (matched.length) return { item, status: 'found', behaviors: matched };
      const closest = closestBehavior(item, fn.behaviors);
      return { item, status: 'missing', behaviors: closest ? [closest] : [] };
    });
    // A near miss is already shown as the closest match of its missing item; it is not also scope creep.
    // The comparison analyzed the file separately, so behaviors are compared by position and outcome, not identity.
    const key = (b: Behavior) => `${b.line}|${b.outcome}`;
    const attempts = new Set(items.filter((r) => r.status === 'missing').flatMap((r) => r.behaviors.map(key)));
    const extra = unplanned(diff, section.items).filter((u) => !attempts.has(key(u.behavior)));
    sections.push({ functionName: section.functionName, file, found: true, items, unplanned: extra, tests: diff?.tests });
  }

  const planned = new Set(sections.map((s) => `${s.file}#${s.functionName}`));
  const unplannedFunctions = [...diffs.entries()]
    .filter(([key]) => !planned.has(key))
    .map(([key, fn]) => ({ file: key.slice(0, key.lastIndexOf('#')), name: fn.name, changes: fn.changes.length }));

  const passed = sections.every((s) => s.found && s.items.every((r) => r.status === 'found' || r.status === 'absent'));
  return { plan, planFile, base: comparison.base, sections, unplannedFunctions, passed };
}

/** Changes since the base that no plan item accounts for. */
function unplanned(diff: FunctionDiff | undefined, items: PlanItem[]): SectionResult['unplanned'] {
  if (!diff) return [];
  const positive = items.filter((i) => !i.negated);
  const negative = items.filter((i) => i.negated);
  const result: SectionResult['unplanned'] = [];
  for (const change of diff.changes) {
    if (change.kind === 'removed') {
      if (!negative.some((i) => itemMatches(i, change.before))) result.push({ change: 'removed', behavior: change.before });
    } else if (!positive.some((i) => itemMatches(i, change.after))) {
      result.push({ change: change.kind === 'added' ? 'added' : 'changed', behavior: change.after });
    }
  }
  return result;
}

function findFile(comparison: BehaviorComparison, name: string): string | undefined {
  return comparison.files.find((f) => f.functions.some((fn) => fn.name === name))?.file;
}

function findFunction(root: string, file: string, name: string, overlay: Map<string, SourceText>): FunctionAnalysis | undefined {
  const absolute = path.join(root, file);
  let text = overlay.get(fileKey(absolute))?.text;
  if (text === undefined) {
    try {
      text = fs.readFileSync(absolute, 'utf8');
    } catch {
      return undefined;
    }
  }
  return analyzeFile(absolute, text).functions.find((fn) => fn.name === name);
}
