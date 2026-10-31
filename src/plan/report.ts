import { truncate } from '../analysis/behaviors';
import { ItemResult, PlanCheck, SectionResult } from './check';
import { describePlanned } from './plan';

/** Markdown checklist of the plan against the code, written for the developer or agent who has to act on it. */
export function renderPlanCheck(check: PlanCheck): string {
  const items = check.sections.flatMap((s) => s.items);
  const count = (...statuses: ItemResult['status'][]) => items.filter((r) => statuses.includes(r.status)).length;
  const unplanned = check.sections.reduce((n, s) => n + s.unplanned.length, 0) + check.unplannedFunctions.length;
  const notFound = check.sections.filter((s) => !s.found).length;

  const lines = [`# Plan check: ${check.plan.title ?? check.planFile}`, '', `Changes compared with ${check.base.label}.`, ''];
  lines.push(
    `**${check.passed ? '✓ Plan met' : '✗ Plan not met'}** — ` +
      [
        `${count('found', 'absent')} of ${items.length} planned behaviors in place`,
        ...(count('missing') ? [`${count('missing')} missing`] : []),
        ...(count('violated') ? [`${count('violated')} that should not exist`] : []),
        ...(notFound ? [`${notFound} planned ${notFound === 1 ? 'function' : 'functions'} not found`] : []),
        ...(unplanned ? [`⚠ ${unplanned} unplanned ${unplanned === 1 ? 'change' : 'changes'}`] : []),
      ].join(' · '),
    '',
  );

  for (const section of check.sections) lines.push(...renderSection(section), '');

  if (check.unplannedFunctions.length) {
    lines.push('## ⚠ Changed but not in the plan', '');
    check.unplannedFunctions.forEach((f) => lines.push(`- \`${f.name}\` in ${f.file} — ${f.changes} behavior ${f.changes === 1 ? 'change' : 'changes'}`));
    lines.push('');
  }
  return lines.join('\n');
}

function renderSection(s: SectionResult): string[] {
  const lines = [`## \`${s.functionName}\`${s.file ? ` in ${s.file}` : ''}`, ''];
  if (!s.found) return [...lines, `✗ Function not found${s.file ? ` in ${s.file}` : ' in the changed files'}.`];

  for (const r of s.items) {
    const where = r.behaviors.map((b) => b.line + 1).join(', ');
    switch (r.status) {
      case 'found':
        lines.push(`- ✓ ${r.item.text} _(line ${where})_`);
        break;
      case 'absent':
        lines.push(`- ✓ ${r.item.text}`);
        break;
      case 'violated':
        lines.push(`- ✗ ${r.item.text} — but the code does this _(line ${where})_`);
        break;
      case 'missing':
        lines.push(`- ✗ ${r.item.text} — not found`);
        if (r.behaviors[0]) lines.push(`  - Closest: ${truncate(describePlanned(r.behaviors[0]), 140)} _(line ${r.behaviors[0].line + 1})_`);
        break;
    }
  }
  for (const u of s.unplanned) {
    const label = u.change === 'removed' ? 'Removed' : u.change === 'added' ? 'Added' : 'Changed';
    lines.push(`- ⚠ ${label}, not in the plan: ${truncate(describePlanned(u.behavior), 140)} _(${u.change === 'removed' ? 'was ' : ''}line ${u.behavior.line + 1})_`);
  }
  if (s.tests) {
    const { count, touched } = s.tests;
    lines.push(
      '',
      count === 0
        ? '**Tests:** ⚠ no tests reach this function'
        : `**Tests:** ${touched ? '✓' : '⚠'} ${count} ${count === 1 ? 'test reaches' : 'tests reach'} it, ${touched ? 'updated in this change' : 'none updated in this change'}`,
    );
  }
  return lines;
}
