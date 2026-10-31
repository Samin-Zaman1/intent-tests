import { FunctionAnalysis } from './analyze';
import { Behavior, Condition } from './behaviors';
import { Mismatch, toComparison } from './mismatch';

/** One condition that was rewritten, e.g. `age <= 18` → `age < 18`. */
export interface ConditionEdit {
  before: string;
  after: string;
  /** Same subject and number, only the strictness changed: the boundary value moved to the other side. */
  boundary: boolean;
}

export type BehaviorChange =
  | { kind: 'added'; after: Behavior }
  | { kind: 'removed'; before: Behavior }
  | { kind: 'outcome-changed'; before: Behavior; after: Behavior }
  /** `edits` is set when the same number of conditions were rewritten in place. */
  | { kind: 'conditions-changed'; before: Behavior; after: Behavior; edits?: ConditionEdit[] };

export interface FunctionDiff {
  name: string;
  status: 'added' | 'removed' | 'changed';
  changes: BehaviorChange[];
  unchanged: number;
  /** Mismatches present after the change that were not there before. */
  newMismatches: Mismatch[];
  before?: FunctionAnalysis;
  after?: FunctionAnalysis;
  /** Tests reaching the function after the change; filled in when the project can be searched. */
  tests?: {
    count: number;
    /** How many of them call it directly. */
    direct: number;
    files: string[];
    /** Whether any of those test files changed. */
    touched: boolean;
    /** Shortest chain of callers for an indirect test, outermost first. */
    via?: string[];
  };
}

export interface FileBehaviorDiff {
  functions: FunctionDiff[];
  /** Functions whose code changed while every behavior stayed the same, e.g. a refactor or added logging. */
  editedWithoutBehaviorChange: string[];
}

export function diffAnalyses(before: FunctionAnalysis[], after: FunctionAnalysis[]): FileBehaviorDiff {
  const beforeByKey = keyed(before);
  const afterByKey = keyed(after);
  const functions: FunctionDiff[] = [];
  const editedWithoutBehaviorChange: string[] = [];

  for (const [key, fn] of afterByKey) {
    const old = beforeByKey.get(key);
    if (!old) {
      const changes = fn.behaviors.map((b): BehaviorChange => ({ kind: 'added', after: b }));
      functions.push({ name: fn.name, status: 'added', changes, unchanged: 0, newMismatches: fn.mismatches, after: fn });
      continue;
    }
    const { changes, unchanged } = diffBehaviors(old.behaviors, fn.behaviors);
    const newMismatches = fn.mismatches.filter((m) => !old.mismatches.some((o) => o.explanation === m.explanation));
    if (changes.length || newMismatches.length) {
      functions.push({ name: fn.name, status: 'changed', changes, unchanged, newMismatches, before: old, after: fn });
    } else if (squash(old.node.getText()) !== squash(fn.node.getText())) {
      editedWithoutBehaviorChange.push(fn.name);
    }
  }

  for (const [key, fn] of beforeByKey) {
    if (afterByKey.has(key)) continue;
    const changes = fn.behaviors.map((b): BehaviorChange => ({ kind: 'removed', before: b }));
    functions.push({ name: fn.name, status: 'removed', changes, unchanged: 0, newMismatches: [], before: fn });
  }

  return { functions, editedWithoutBehaviorChange };
}

/** Functions keyed by name; repeated names in one file get `#1`, `#2` in order of appearance. */
function keyed(fns: FunctionAnalysis[]): Map<string, FunctionAnalysis> {
  const map = new Map<string, FunctionAnalysis>();
  const seen = new Map<string, number>();
  for (const fn of fns) {
    const n = seen.get(fn.name) ?? 0;
    seen.set(fn.name, n + 1);
    map.set(n ? `${fn.name}#${n}` : fn.name, fn);
  }
  return map;
}

const conditionsOf = (b: Behavior) => b.conditions.map((c) => c.text).join(' && ');
const keyOf = (b: Behavior) => `${conditionsOf(b)} => ${b.outcome}`;

/**
 * Matches behaviors in three passes: identical ones are unchanged; then same conditions with a new outcome;
 * then same outcome under related conditions. Whatever is left was added or removed.
 */
export function diffBehaviors(before: Behavior[], after: Behavior[]): { changes: BehaviorChange[]; unchanged: number } {
  const oldLeft = [...before];
  const newLeft: Behavior[] = [];
  let unchanged = 0;
  for (const b of after) {
    const i = oldLeft.findIndex((o) => keyOf(o) === keyOf(b));
    if (i >= 0) {
      oldLeft.splice(i, 1);
      unchanged++;
    } else {
      newLeft.push(b);
    }
  }

  const changes: BehaviorChange[] = [];
  for (const [o, n] of pairUp(oldLeft, newLeft, (o, n) => (conditionsOf(o) === conditionsOf(n) ? 1 : undefined))) {
    changes.push({ kind: 'outcome-changed', before: o, after: n });
  }
  for (const [o, n] of pairUp(oldLeft, newLeft, (o, n) => (o.outcome === n.outcome ? relatedness(o, n) : undefined))) {
    changes.push({ kind: 'conditions-changed', before: o, after: n, edits: conditionEdits(o, n) });
  }
  newLeft.forEach((n) => changes.push({ kind: 'added', after: n }));
  oldLeft.forEach((o) => changes.push({ kind: 'removed', before: o }));
  return { changes, unchanged };
}

/** Repeatedly takes the best-scoring pair, removing both from their lists. A score of undefined means "never pair". */
function pairUp(
  olds: Behavior[],
  news: Behavior[],
  score: (o: Behavior, n: Behavior) => number | undefined,
): [Behavior, Behavior][] {
  const pairs: [Behavior, Behavior][] = [];
  for (;;) {
    let best: { i: number; j: number; score: number } | undefined;
    for (let i = 0; i < olds.length; i++) {
      for (let j = 0; j < news.length; j++) {
        const s = score(olds[i], news[j]);
        if (s !== undefined && (!best || s > best.score)) best = { i, j, score: s };
      }
    }
    if (!best) return pairs;
    pairs.push([olds[best.i], news[best.j]]);
    olds.splice(best.i, 1);
    news.splice(best.j, 1);
  }
}

/** How much two condition lists overlap: 2 per identical condition, 1 per comparison on the same subject. */
function relatedness(o: Behavior, n: Behavior): number | undefined {
  let score = 0;
  for (const c of n.conditions) {
    if (o.conditions.some((oc) => oc.text === c.text)) score += 2;
    else if (o.conditions.some((oc) => sameSubject(oc, c))) score += 1;
  }
  return score > 0 ? score : undefined;
}

function sameSubject(a: Condition, b: Condition): boolean {
  const ca = toComparison(a);
  const cb = toComparison(b);
  return !!ca && !!cb && ca.subject === cb.subject;
}

function conditionEdits(o: Behavior, n: Behavior): ConditionEdit[] | undefined {
  if (o.conditions.length !== n.conditions.length) return undefined;
  const edits: ConditionEdit[] = [];
  o.conditions.forEach((oc, i) => {
    const nc = n.conditions[i];
    if (oc.text === nc.text) return;
    const ca = toComparison(oc);
    const cb = toComparison(nc);
    const boundary = !!ca && !!cb && ca.subject === cb.subject && ca.value === cb.value && ca.op[0] === cb.op[0];
    edits.push({ before: oc.text, after: nc.text, boundary });
  });
  return edits;
}

function squash(text: string): string {
  return text.replace(/\s+/g, ' ');
}
