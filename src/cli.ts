#!/usr/bin/env node
import { compareBehaviors } from './compare';
import { renderComparison } from './diffReport';

const USAGE = `Usage: intent-tests diff [--base <git ref> | --branch] [--head <git ref>]

Shows how function behaviors changed between a git ref and the working tree.
  --base <ref>  Compare against this commit, branch or tag (default: HEAD, i.e. uncommitted changes)
  --branch      Compare against where the current branch left main or master
  --head <ref>  Compare up to this commit instead of the working tree (skips the test lookup)`;

async function main(argv: string[]): Promise<number> {
  const [command, ...args] = argv;
  if (command !== 'diff') {
    console.error(USAGE);
    return 2;
  }
  let base = 'HEAD';
  let head: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--branch') base = 'branch';
    else if (args[i] === '--base' && args[i + 1]) base = args[++i];
    else if (args[i] === '--head' && args[i + 1]) head = args[++i];
    else {
      console.error(USAGE);
      return 2;
    }
  }
  process.stdout.write(renderComparison(await compareBehaviors(process.cwd(), base, { head })));
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => (process.exitCode = code),
  (error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  },
);
