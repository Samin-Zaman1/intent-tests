import { Behavior, truncate } from './analysis/behaviors';
import { BehaviorChange, FunctionDiff, ValueChange } from './analysis/diff';
import { BehaviorComparison } from './compare';

/** Markdown summary of how behavior changed, written for reviewing a change (often one an AI agent made). */
export function renderComparison(c: BehaviorComparison): string {
  const lines = [c.head ? `# Behavior changes from ${c.base.label} to ${c.head.label}` : `# Behavior changes since ${c.base.label}`, ''];
  const functions = c.files.flatMap((f) => f.functions);
  const edited = c.files.flatMap((f) => f.editedWithoutBehaviorChange);
  const values = c.files.flatMap((f) => f.valuesChanged);

  if (!functions.length && !values.length) {
    lines.push(
      edited.length
        ? `No behavior changes. ${plural(edited.length, 'function')} edited without changing behavior: ${edited.map((n) => `\`${n}\``).join(', ')}.`
        : 'No behavior changes in changed source files.',
    );
    return lines.join('\n') + '\n';
  }

  lines.push(...summary(functions, edited.length, values.length), '');

  for (const file of c.files) {
    lines.push(`## ${file.file}`, '');
    for (const value of file.valuesChanged) lines.push(...renderValue(value), '');
    for (const fn of file.functions) lines.push(...renderFunction(fn), '');
    if (file.editedWithoutBehaviorChange.length) {
      lines.push(`_Edited without behavior change: ${file.editedWithoutBehaviorChange.map((n) => `\`${n}\``).join(', ')}_`, '');
    }
  }

  if (c.testFilesChanged.length) {
    lines.push('## Test files changed', '', ...c.testFilesChanged.map((f) => `- ${f}`), '');
  }
  return lines.join('\n');
}

function summary(functions: FunctionDiff[], editedCount: number, valueCount: number): string[] {
  const count = (status: FunctionDiff['status']) => functions.filter((f) => f.status === status).length;
  const changes = functions.flatMap((f) => f.changes);
  const kinds = (...k: BehaviorChange['kind'][]) => changes.filter((ch) => k.includes(ch.kind)).length;
  const parts = [
    `**Functions:** ${count('changed')} changed, ${count('added')} added, ${count('removed')} removed` +
      (editedCount ? `, ${editedCount} edited without behavior change` : ''),
    `**Behaviors:** ${kinds('added')} added, ${kinds('outcome-changed', 'conditions-changed', 'steps-changed')} changed, ${kinds('removed')} removed`,
    ...(valueCount ? [`**Module values changed:** ${valueCount}`] : []),
  ];

  const live = functions.filter((f) => f.status !== 'removed' && f.tests);
  const untested = live.filter((f) => f.tests!.count === 0).length;
  const stale = live.filter((f) => f.tests!.count > 0 && !f.tests!.touched).length;
  const mismatches = functions.reduce((n, f) => n + f.newMismatches.length, 0);
  const warnings = [
    ...(untested ? [`⚠ ${plural(untested, 'function')} with behavior changes ${untested === 1 ? 'is' : 'are'} not reached by any test`] : []),
    ...(stale ? [`⚠ ${plural(stale, 'function')} changed behavior but ${stale === 1 ? 'its' : 'their'} tests were not updated`] : []),
    ...(mismatches ? [`⚠ ${plural(mismatches, 'possible mismatch', 'possible mismatches')} introduced`] : []),
  ];
  return [...parts.map((p) => `- ${p}`), ...warnings.map((w) => `- ${w}`)];
}

function renderFunction(fn: FunctionDiff): string[] {
  const lines = [`### \`${fn.name}\` — ${fn.status}`, ''];
  if (fn.tests) {
    const { count, direct, via, touched } = fn.tests;
    const files = fn.tests.files.join(', ');
    const reach =
      direct || !via
        ? `${plural(count, 'test')} reach it`
        : `${plural(count, 'test')} reach it only indirectly, via ${via.map((name) => `\`${name}\``).join(' → ')}`;
    if (count === 0) lines.push('**Tests:** ⚠ no tests reach this function, directly or through its callers', '');
    else if (!touched) lines.push(`**Tests:** ⚠ ${reach} (${files}), none updated in this change`, '');
    else lines.push(`**Tests:** ✓ ${reach}, updated in this change (${files})`, '');
  }
  fn.changes.filter((c) => c.kind !== 'steps-changed').forEach((change) => lines.push(`- ${renderChange(change)}`));
  lines.push(...renderStepChanges(fn.changes));
  fn.newMismatches.forEach((m) => lines.push(`- ⚠ **Possible mismatch** _(line ${m.line + 1})_: ${m.explanation}`));
  if (fn.unchanged) lines.push(`- _${plural(fn.unchanged, 'other behavior')} unchanged_`);
  return lines;
}

/** One edit early in a function changes the steps of every path after it, so these are grouped by the edit. */
function renderStepChanges(changes: BehaviorChange[]): string[] {
  const groups = new Map<string, { removed: string[]; added: string[]; outcomes: string[] }>();
  for (const change of changes) {
    if (change.kind !== 'steps-changed') continue;
    const key = JSON.stringify([change.removedSteps, change.addedSteps]);
    const group = groups.get(key) ?? { removed: change.removedSteps, added: change.addedSteps, outcomes: [] };
    group.outcomes.push(change.after.outcome);
    groups.set(key, group);
  }
  return [...groups.values()].map(({ removed, added, outcomes }) => {
    const affected = outcomes.length === 1 ? truncate(outcomes[0], 60) : `${outcomes.length} paths`;
    const edits = pairSteps(removed, added).map(([before, after]) => {
      if (before === undefined) return `added \`${truncate(after!)}\``;
      if (after === undefined) return `removed \`${truncate(before)}\``;
      const [b, a] = focusOnDifference(before, after);
      return `\`${b}\` → \`${a}\``;
    });
    return edits.length === 1
      ? `- ✏️ Computation changed before ${affected}: ${edits[0]}`
      : [`- ✏️ Computation changed before ${affected}:`, ...edits.map((e) => `  - ${e}`)].join('\n');
  });
}

/** Matches each removed step with the most similar added one, so each rewrite can be shown as its own before → after. */
function pairSteps(removed: string[], added: string[]): [string | undefined, string | undefined][] {
  const rest = [...added];
  const pairs: [string | undefined, string | undefined][] = [];
  for (const before of removed) {
    let best = -1;
    let bestScore = 0;
    rest.forEach((after, i) => {
      const score = sharedEnds(before, after);
      if (score > bestScore) [best, bestScore] = [i, score];
    });
    if (best >= 0 && bestScore >= Math.min(before.length, rest[best].length) / 3) {
      pairs.push([before, rest[best]]);
      rest.splice(best, 1);
    } else {
      pairs.push([before, undefined]);
    }
  }
  rest.forEach((after) => pairs.push([undefined, after]));
  return pairs;
}

/** Length of the common prefix plus the common suffix. */
function sharedEnds(a: string, b: string): number {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  return start + end;
}

function renderValue(value: ValueChange): string[] {
  const [before, after] = focusOnDifference(value.before ?? '(none)', value.after ?? '(none)');
  const readers = value.usedBy.length ? `read by ${value.usedBy.map((n) => `\`${n}\``).join(', ')}` : 'not read by functions in this file';
  return [
    `### Module value \`${value.name}\` — ${value.before === undefined ? 'added' : value.after === undefined ? 'removed' : 'changed'}`,
    '',
    `${readers}${value.exported ? '; exported, so other files may read it too' : ''}`,
    '',
    `- \`${before}\` → \`${after}\``,
  ];
}

function renderChange(change: BehaviorChange): string {
  switch (change.kind) {
    case 'steps-changed':
      return renderStepChanges([change])[0];
    case 'added':
      return `➕ ${when(change.after)} → ${truncate(change.after.outcome)} ${at(change.after)}`;
    case 'removed':
      return `➖ ${when(change.before)} → ${truncate(change.before.outcome)} _(was line ${change.before.line + 1})_`;
    case 'outcome-changed': {
      const [before, after] = focusOnDifference(change.before.outcome, change.after.outcome);
      return `✏️ ${when(change.after)}: ${before} → **${after}** ${at(change.after)}`;
    }
    case 'conditions-changed': {
      const { edits } = change;
      const outcome = truncate(change.after.outcome);
      if (edits?.length) {
        const rewritten = edits.map((e) => `\`${e.before}\` → \`${e.after}\``).join(', ');
        const boundary = edits.every((e) => e.boundary) ? ' **(boundary moved)**' : '';
        return `✏️ ${outcome}: ${rewritten}${boundary} ${at(change.after)}`;
      }
      return `✏️ ${outcome}: was ${lower(when(change.before))}, now ${lower(when(change.after))} ${at(change.after)}`;
    }
  }
}

/** Trims two long texts to the part where they differ, with a little context on each side. */
export function focusOnDifference(before: string, after: string, max = 80): [string, string] {
  if (before.length <= max && after.length <= max) return [before, after];
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let end = 0;
  while (end < before.length - start && end < after.length - start && before[before.length - 1 - end] === after[after.length - 1 - end]) {
    end++;
  }
  const clip = (text: string) => {
    const from = start > 20 ? text.lastIndexOf(' ', start - 20) + 1 : 0;
    const to = Math.min(text.length, text.length - end + 20);
    const body = text.slice(from, to);
    const shown = body.length > max ? body.slice(0, max - 1) : body;
    return `${from > 0 ? '…' : ''}${shown}${to < text.length || shown.length < body.length ? '…' : ''}`;
  };
  return [clip(before), clip(after)];
}

function when(b: Behavior): string {
  return b.conditions.length ? `When ${b.conditions.map((c) => `\`${c.text}\``).join(' and ')}` : 'Always';
}

function lower(text: string): string {
  return text[0].toLowerCase() + text.slice(1);
}

function at(b: Behavior): string {
  return `_(line ${b.line + 1})_`;
}

function plural(n: number, word: string, pluralWord = `${word}s`): string {
  return `${n} ${n === 1 ? word : pluralWord}`;
}
