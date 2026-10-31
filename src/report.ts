import { FunctionAnalysis } from './analysis/analyze';
import { truncate } from './analysis/behaviors';
import { CallSite } from './analysis/callers';
import { docOf, parseBranchName, splitIdentifier } from './analysis/evidence';
import { GitContext } from './git';

export interface ReportContext {
  file: string;
  git?: GitContext;
  /** Undefined when callers could not be looked up; file names already relative. */
  callers?: CallSite[];
  closestTest?: string;
}

/** Markdown summary of what a function does and what the codebase says it should do. */
export function renderReport(fn: FunctionAnalysis, ctx: ReportContext): string {
  const lines: string[] = [`# \`${fn.name}\``, '', `${ctx.file}:${fn.line + 1}`, ''];

  lines.push(`## Behaviors (${fn.behaviors.length})`, '');
  fn.behaviors.forEach((b, i) => {
    const when = b.conditions.map((c) => `\`${c.text}\``).join(' and ');
    lines.push(`${i + 1}. ${when ? `**When** ${when}` : '**Always**'} → ${truncate(b.outcome)} _(line ${b.line + 1})_`);
  });

  if (fn.mismatches.length) {
    lines.push('', '## ⚠ Possible mismatches', '');
    fn.mismatches.forEach((m) => lines.push(`- Line ${m.line + 1}: ${m.explanation}`));
  }

  lines.push('', '## Evidence of intent', '');
  lines.push(`- **Name:** ${splitIdentifier(fn.name).join(' ')}`);
  if (fn.params.length) {
    lines.push(`- **Parameters:** ${fn.params.map((p) => `\`${p.type ? `${p.name}: ${p.type}` : p.name}\``).join(', ')}`);
  }
  if (fn.returnType) lines.push(`- **Returns:** \`${fn.returnType}\``);
  const doc = docOf(fn);
  if (doc.summary) lines.push(`- **Doc:** ${doc.summary}`);
  doc.tags.forEach((tag) => lines.push(`- **@${tag.name}** ${tag.text}`));
  const branch = parseBranchName(ctx.git?.branch);
  if (branch) lines.push(`- **Branch:** ${[branch.ticket, branch.summary].filter(Boolean).join(' — ')}`);
  if (ctx.git?.recentCommits.length) {
    lines.push('- **Recent commits to this file:**');
    ctx.git.recentCommits.forEach((subject) => lines.push(`  - ${subject}`));
  }

  if (ctx.callers) {
    lines.push(...usageSection(fn, ctx.callers.filter((c) => !c.isTest)));
    lines.push(...testsSection(ctx.callers.filter((c) => c.isTest), ctx.closestTest));
  }

  return lines.join('\n') + '\n';
}

function usageSection(fn: FunctionAnalysis, callers: CallSite[]): string[] {
  const lines = ['', '## How it is used', ''];
  if (!callers.length) return [...lines, '- No callers found in this project.'];

  const files = new Set(callers.map((c) => c.fileName)).size;
  const count = (label: string, n: number) => (n ? [`${n} ${label}`] : []);
  const habits = [
    ...count('handle errors from it', callers.filter((c) => c.handlesErrors).length),
    ...count('check the result for null', callers.filter((c) => c.resultUse === 'null-checked').length),
    ...count('use the result as a condition', callers.filter((c) => c.resultUse === 'condition').length),
    ...count('ignore the result', callers.filter((c) => c.resultUse === 'ignored').length),
    ...count('await it', callers.filter((c) => c.awaited).length),
  ];
  lines.push(`- **Callers:** ${plural(callers.length, 'call site')} in ${plural(files, 'file')}${habits.length ? ` — ${habits.join(', ')}` : ''}`);

  fn.params.forEach((param, i) => {
    const values = [...new Set(callers.map((c) => c.args[i]).filter((v): v is string => v !== undefined))];
    if (values.length) lines.push(`- **Values passed for \`${param.name}\`:** ${values.slice(0, 5).map((v) => `\`${v}\``).join(', ')}`);
  });
  callers.slice(0, 5).forEach((c) => lines.push(`  - ${c.fileName}:${c.line + 1}`));
  return lines;
}

function testsSection(tests: CallSite[], closestTest: string | undefined): string[] {
  const lines = ['', `## Existing tests (${tests.length})`, ''];
  if (!tests.length) lines.push('- None call this function directly.');
  tests.forEach((t) => {
    const name = t.testName ? `"${t.testName}"` : 'Called from a test helper';
    lines.push(`- ${name}${t.assertion ? `: \`${t.assertion}\`` : ''} _(${t.fileName}:${t.line + 1})_`);
  });
  lines.push(closestTest ? `- **Closest test file:** ${closestTest}` : '- **Closest test file:** none in this project');
  return lines;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}
