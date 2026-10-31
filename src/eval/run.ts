#!/usr/bin/env node
/**
 * Accuracy evaluation on real bug-fix commits from open-source projects.
 *
 *   node out/eval/run.js [--commits 60] [--repos zod,ky] [--out eval-results]
 *
 * Repos are cloned once into .eval-cache/. Results go to <out>/results.json and <out>/summary.md.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { analyzeSource } from '../analysis/analyze';
import { BehaviorChange } from '../analysis/diff';
import { compareBehaviors } from '../compare';
import { git, lines } from '../git';
import { FIX_SUBJECT, FileStat, isEvaluatedSource, isIdentifierOnly, smallFix } from './metrics';

const REPOS: Record<string, string> = {
  vue: 'https://github.com/vuejs/core.git',
  zod: 'https://github.com/colinhacks/zod.git',
  'date-fns': 'https://github.com/date-fns/date-fns.git',
  axios: 'https://github.com/axios/axios.git',
  immer: 'https://github.com/immerjs/immer.git',
  ky: 'https://github.com/sindresorhus/ky.git',
};
const HISTORY_DEPTH = 3000;

interface CommitResult {
  repo: string;
  sha: string;
  subject: string;
  sourceFiles: number;
  linesChanged: number;
  ms: number;
  error?: string;
  /** What the tool saw: behavior changes, only edits that kept behavior, or no functions touched at all. */
  verdict: 'behavior-change' | 'edit-only' | 'nothing';
  functions: { changed: number; added: number; removed: number; editedOnly: number };
  valuesChanged: number;
  changes: Record<BehaviorChange['kind'], number>;
  identifierOnly: number;
  boundaryMoves: string[];
  /** Mismatches in the buggy version that the fix removed: the tool would have caught this bug. */
  mismatchesFixed: string[];
  mismatchesIntroduced: string[];
}

interface ScanResult {
  repo: string;
  file: string;
  line: number;
  code: string;
  explanation: string;
}

function parseArgs(argv: string[]) {
  const options = { commits: 60, repos: Object.keys(REPOS), out: 'eval-results' };
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i + 1];
    if (argv[i] === '--commits' && value) options.commits = Number(argv[++i]);
    else if (argv[i] === '--repos' && value) options.repos = argv[++i].split(',');
    else if (argv[i] === '--out' && value) options.out = argv[++i];
    else throw new Error(`Unknown argument ${argv[i]}`);
  }
  const unknown = options.repos.filter((r) => !REPOS[r]);
  if (unknown.length) throw new Error(`Unknown repos: ${unknown.join(', ')}. Known: ${Object.keys(REPOS).join(', ')}`);
  return options;
}

function ensureClone(name: string): string {
  const dir = path.resolve('.eval-cache', name);
  if (!fs.existsSync(path.join(dir, '.git'))) {
    console.error(`Cloning ${name}…`);
    execFileSync('git', ['clone', '--quiet', '--depth', String(HISTORY_DEPTH), '--single-branch', '--no-tags', REPOS[name], dir], {
      stdio: 'inherit',
    });
  }
  return dir;
}

async function candidates(dir: string, limit: number): Promise<{ sha: string; parent: string; subject: string; stats: FileStat[] }[]> {
  const log = lines(await git(dir, ['log', '--no-merges', '--format=%H%x09%P%x09%s', '-n', String(HISTORY_DEPTH - 1)]));
  const picked = [];
  for (const entry of log) {
    if (picked.length >= limit) break;
    const [sha, parent, ...rest] = entry.split('\t');
    const subject = rest.join('\t');
    if (!parent || parent.includes(' ') || !FIX_SUBJECT.test(subject)) continue;
    const numstat = lines(await git(dir, ['diff', '--numstat', '--no-renames', parent, sha]));
    const stats = numstat
      .map((row) => row.split('\t'))
      .filter(([added, removed]) => added !== '-' && removed !== '-')
      .map(([added, removed, file]) => ({ file, added: Number(added), removed: Number(removed) }));
    if (smallFix(stats)) picked.push({ sha, parent, subject, stats });
  }
  return picked;
}

async function evaluateCommit(repo: string, dir: string, c: { sha: string; parent: string; subject: string; stats: FileStat[] }): Promise<CommitResult> {
  const size = smallFix(c.stats)!;
  const result: CommitResult = {
    repo,
    sha: c.sha.slice(0, 10),
    subject: c.subject,
    ...size,
    ms: 0,
    verdict: 'nothing',
    functions: { changed: 0, added: 0, removed: 0, editedOnly: 0 },
    valuesChanged: 0,
    changes: { added: 0, removed: 0, 'steps-changed': 0, 'outcome-changed': 0, 'conditions-changed': 0 },
    identifierOnly: 0,
    boundaryMoves: [],
    mismatchesFixed: [],
    mismatchesIntroduced: [],
  };
  const started = Date.now();
  try {
    const comparison = await compareBehaviors(dir, c.parent, { head: c.sha });
    for (const file of comparison.files.filter((f) => isEvaluatedSource(f.file))) {
      result.functions.editedOnly += file.editedWithoutBehaviorChange.length;
      result.valuesChanged += file.valuesChanged.length;
      for (const fn of file.functions) {
        result.functions[fn.status]++;
        for (const change of fn.changes) {
          result.changes[change.kind]++;
          if (isIdentifierOnly(change)) result.identifierOnly++;
          if (change.kind === 'conditions-changed' && change.edits?.length && change.edits.every((e) => e.boundary)) {
            result.boundaryMoves.push(`${file.file} ${fn.name}: ${change.edits.map((e) => `${e.before} → ${e.after}`).join(', ')}`);
          }
        }
        result.mismatchesIntroduced.push(...fn.newMismatches.map((m) => `${file.file}:${m.line + 1} ${m.explanation}`));
        const after = new Set(fn.after?.mismatches.map((m) => m.explanation));
        result.mismatchesFixed.push(
          ...(fn.before?.mismatches ?? []).filter((m) => !after.has(m.explanation)).map((m) => `${file.file}:${m.line + 1} ${m.explanation}`),
        );
      }
    }
    const f = result.functions;
    result.verdict =
      f.changed + f.added + f.removed + result.valuesChanged > 0 ? 'behavior-change' : f.editedOnly > 0 ? 'edit-only' : 'nothing';
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  }
  result.ms = Date.now() - started;
  return result;
}

/** Mismatch warnings across the whole current codebase: each is a real bug or a false alarm, to be reviewed by hand. */
async function scanMismatches(repo: string, dir: string): Promise<ScanResult[]> {
  const found: ScanResult[] = [];
  for (const file of lines(await git(dir, ['ls-files'])).filter(isEvaluatedSource)) {
    const text = fs.readFileSync(path.join(dir, file), 'utf8');
    const sourceLines = text.split('\n');
    try {
      for (const fn of analyzeSource(file, text)) {
        for (const m of fn.mismatches) {
          found.push({ repo, file, line: m.line + 1, code: sourceLines[m.line]?.trim() ?? '', explanation: m.explanation });
        }
      }
    } catch (error) {
      console.error(`${repo} ${file}: ${error instanceof Error ? error.message : error}`);
    }
  }
  return found;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
}

function pct(n: number, total: number): string {
  return total ? `${Math.round((100 * n) / total)}%` : '–';
}

function summarize(results: CommitResult[], scan: ScanResult[]): string {
  const out = ['# Intent Tests accuracy evaluation', '', `Generated ${new Date().toISOString()}`, ''];
  out.push('## Per repository', '', '| Repo | Fix commits | Errors | Behavior change | Edit only | Nothing seen | Median ms |', '|---|---|---|---|---|---|---|');
  const byRepo = new Map<string, CommitResult[]>();
  results.forEach((r) => byRepo.set(r.repo, [...(byRepo.get(r.repo) ?? []), r]));
  for (const [repo, rs] of [...byRepo, ['**All**', results] as [string, CommitResult[]]]) {
    const ok = rs.filter((r) => !r.error);
    const count = (v: CommitResult['verdict']) => pct(ok.filter((r) => r.verdict === v).length, ok.length);
    out.push(`| ${repo} | ${rs.length} | ${rs.length - ok.length} | ${count('behavior-change')} | ${count('edit-only')} | ${count('nothing')} | ${median(rs.map((r) => r.ms))} |`);
  }

  const ok = results.filter((r) => !r.error);
  const total = (k: BehaviorChange['kind']) => ok.reduce((n, r) => n + r.changes[k], 0);
  const changed = total('outcome-changed') + total('conditions-changed') + total('steps-changed');
  const identifierOnly = ok.reduce((n, r) => n + r.identifierOnly, 0);
  const perFix = (r: CommitResult) => Object.values(r.changes).reduce((a, b) => a + b, 0);
  out.push(
    '',
    '## Behavior changes reported',
    '',
    `- Added ${total('added')}, removed ${total('removed')}, changed ${changed} (outcome ${total('outcome-changed')}, conditions ${total('conditions-changed')}, steps ${total('steps-changed')})`,
    `- Module values changed: ${ok.reduce((n, r) => n + r.valuesChanged, 0)}`,
    `- Changes that differ only in names (rename noise, or a different variable checked): ${identifierOnly} of ${changed} (${pct(identifierOnly, changed)})`,
    `- Behavior changes per fix: median ${median(ok.map(perFix))}, 90th percentile ${[...ok.map(perFix)].sort((a, b) => a - b)[Math.floor(ok.length * 0.9)] ?? 0}`,
  );

  const section = (title: string, items: string[], empty: string) => {
    out.push('', `## ${title} (${items.length})`, '');
    out.push(...(items.length ? items.map((i) => `- ${i}`) : [`_${empty}_`]));
  };
  const label = (r: CommitResult) => `**${r.repo} ${r.sha}** ${r.subject}`;
  section('Mismatches the fix removed (bugs the tool would have caught)', ok.flatMap((r) => r.mismatchesFixed.map((m) => `${label(r)} — ${m}`)), 'None.');
  section('Mismatches a fix introduced (likely false alarms)', ok.flatMap((r) => r.mismatchesIntroduced.map((m) => `${label(r)} — ${m}`)), 'None.');
  section('Boundary moves', ok.flatMap((r) => r.boundaryMoves.map((b) => `${label(r)} — ${b}`)), 'None.');
  section('Fixes where the tool saw nothing (review: real gaps vs changes outside functions)', ok.filter((r) => r.verdict === 'nothing').slice(0, 25).map(label), 'None.');
  section('Fixes the tool called "edit only" (review: should be types, exports or formatting only)', ok.filter((r) => r.verdict === 'edit-only').slice(0, 25).map(label), 'None.');
  section('Errors', results.filter((r) => r.error).map((r) => `${label(r)} — ${r.error}`), 'None.');
  section('Mismatch warnings in current code (review each: real bug or false alarm?)', scan.map((s) => `**${s.repo}** ${s.file}:${s.line} \`${s.code}\` — ${s.explanation}`), 'None.');
  return out.join('\n') + '\n';
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const results: CommitResult[] = [];
  const scan: ScanResult[] = [];
  for (const repo of options.repos) {
    const dir = ensureClone(repo);
    const picked = await candidates(dir, options.commits);
    console.error(`${repo}: evaluating ${picked.length} fix commits`);
    for (const c of picked) results.push(await evaluateCommit(repo, dir, c));
    scan.push(...(await scanMismatches(repo, dir)));
  }
  fs.mkdirSync(options.out, { recursive: true });
  fs.writeFileSync(path.join(options.out, 'results.json'), JSON.stringify({ results, scan }, null, 2));
  fs.writeFileSync(path.join(options.out, 'summary.md'), summarize(results, scan));
  console.error(`Wrote ${path.join(options.out, 'summary.md')}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
