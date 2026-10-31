#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';
import { analyzeSource } from './analysis/analyze';
import { compareBehaviors } from './compare';
import { renderComparison } from './diffReport';
import { repoRoot } from './git';
import { DEFAULT_PLAN, checkPlan } from './plan/check';
import { planSection } from './plan/plan';
import { renderPlanCheck } from './plan/report';

const USAGE = `Usage:
  intent-tests diff [--base <ref> | --branch] [--head <ref>]
      How function behaviors changed between a git ref and the working tree.
      --base <ref>  Compare against this commit, branch or tag (default: HEAD, i.e. uncommitted changes)
      --branch      Compare against where the current branch left main or master
      --head <ref>  Compare up to this commit instead of the working tree (skips the test lookup)

  intent-tests plan <file> [function...] [--title <title>]
      Prints a plan describing what the functions do now, as a starting point to edit.
      Save it as ${DEFAULT_PLAN}, then change it to describe what they should do.

  intent-tests check [plan file] [--base <ref> | --branch]
      Checks the code against a plan (default ${DEFAULT_PLAN}): which planned behaviors exist,
      which are missing, and what changed that the plan does not mention. Exits with 1 if the plan is not met.`;

class UsageError extends Error {}

/** Splits `--flag value` options from positional arguments. `--branch` takes no value. */
function parseArgs(args: string[]): { positional: string[]; flags: Map<string, string> } {
  const positional: string[] = [];
  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--branch') flags.set('base', 'branch');
    else if (args[i].startsWith('--')) {
      if (args[i + 1] === undefined) throw new UsageError();
      flags.set(args[i].slice(2), args[++i]);
    } else positional.push(args[i]);
  }
  return { positional, flags };
}

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  const { positional, flags } = parseArgs(rest);

  if (command === 'diff') {
    const comparison = await compareBehaviors(process.cwd(), flags.get('base') ?? 'HEAD', { head: flags.get('head') });
    process.stdout.write(renderComparison(comparison));
    return 0;
  }

  if (command === 'plan') {
    const [file, ...names] = positional;
    if (!file) throw new UsageError();
    const absolute = path.resolve(file);
    const root = (await repoRoot(path.dirname(absolute))) ?? process.cwd();
    const relative = path.relative(root, absolute).split(path.sep).join('/');
    const functions = analyzeSource(absolute, fs.readFileSync(absolute, 'utf8'));
    const chosen = names.length ? functions.filter((fn) => names.includes(fn.name)) : functions.filter((fn) => !fn.parent);
    const unknown = names.filter((n) => !functions.some((fn) => fn.name === n));
    if (unknown.length) throw new Error(`Not found in ${file}: ${unknown.join(', ')}. Functions: ${functions.map((f) => f.name).join(', ')}`);
    process.stdout.write([`# ${flags.get('title') ?? 'Plan'}`, '', ...chosen.map((fn) => planSection(fn, relative))].join('\n'));
    return 0;
  }

  if (command === 'check') {
    const check = await checkPlan(process.cwd(), positional[0], { base: flags.get('base') });
    process.stdout.write(renderPlanCheck(check));
    return check.passed ? 0 : 1;
  }

  throw new UsageError();
}

main(process.argv.slice(2)).then(
  (code) => (process.exitCode = code),
  (error) => {
    console.error(error instanceof UsageError ? USAGE : error instanceof Error ? error.message : error);
    process.exitCode = error instanceof UsageError ? 2 : 1;
  },
);
