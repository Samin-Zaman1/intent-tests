import { Behavior, truncate } from './analysis/behaviors';
import { BehaviorChange, FunctionDiff } from './analysis/diff';
import { BehaviorComparison } from './compare';

/** Markdown summary of how behavior changed, written for reviewing a change (often one an AI agent made). */
export function renderComparison(c: BehaviorComparison): string {
  const lines = [`# Behavior changes since ${c.base.label}`, ''];
  const functions = c.files.flatMap((f) => f.functions);
  const edited = c.files.flatMap((f) => f.editedWithoutBehaviorChange);

  if (!functions.length) {
    lines.push(
      edited.length
        ? `No behavior changes. ${plural(edited.length, 'function')} edited without changing behavior: ${edited.map((n) => `\`${n}\``).join(', ')}.`
        : 'No behavior changes in changed source files.',
    );
    return lines.join('\n') + '\n';
  }

  lines.push(...summary(functions, edited.length), '');

  for (const file of c.files) {
    lines.push(`## ${file.file}`, '');
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

function summary(functions: FunctionDiff[], editedCount: number): string[] {
  const count = (status: FunctionDiff['status']) => functions.filter((f) => f.status === status).length;
  const changes = functions.flatMap((f) => f.changes);
  const kinds = (...k: BehaviorChange['kind'][]) => changes.filter((ch) => k.includes(ch.kind)).length;
  const parts = [
    `**Functions:** ${count('changed')} changed, ${count('added')} added, ${count('removed')} removed` +
      (editedCount ? `, ${editedCount} edited without behavior change` : ''),
    `**Behaviors:** ${kinds('added')} added, ${kinds('outcome-changed', 'conditions-changed')} changed, ${kinds('removed')} removed`,
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
  fn.changes.forEach((change) => lines.push(`- ${renderChange(change)}`));
  fn.newMismatches.forEach((m) => lines.push(`- ⚠ **Possible mismatch** _(line ${m.line + 1})_: ${m.explanation}`));
  if (fn.unchanged) lines.push(`- _${plural(fn.unchanged, 'other behavior')} unchanged_`);
  return lines;
}

function renderChange(change: BehaviorChange): string {
  switch (change.kind) {
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
    return truncate(`${from > 0 ? '…' : ''}${text.slice(from, to)}`, max) + (to < text.length ? '…' : '');
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
