import { FunctionAnalysis } from './analysis/analyze';
import { docOf, parseBranchName, splitIdentifier } from './analysis/evidence';
import { GitContext } from './git';

/** Markdown summary of what a function does and what the codebase says it should do. */
export function renderReport(fn: FunctionAnalysis, ctx: { file: string; git?: GitContext }): string {
  const lines: string[] = [`# \`${fn.name}\``, '', `${ctx.file}:${fn.line + 1}`, ''];

  lines.push(`## Behaviors (${fn.behaviors.length})`, '');
  fn.behaviors.forEach((b, i) => {
    const when = b.conditions.map((c) => `\`${c.text}\``).join(' and ');
    lines.push(`${i + 1}. ${when ? `**When** ${when}` : '**Always**'} → ${b.outcome} _(line ${b.line + 1})_`);
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

  return lines.join('\n') + '\n';
}
