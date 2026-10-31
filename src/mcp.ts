#!/usr/bin/env node
/**
 * MCP server exposing Intent Tests to AI coding agents.
 *
 *   node out/mcp.js [--root <repo>]      (defaults to the current directory)
 *
 * Every tool is read-only: agents write the plan file themselves.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { analyzeSource } from './analysis/analyze';
import { truncate } from './analysis/behaviors';
import { closestTestFile } from './analysis/tests';
import { compareBehaviors } from './compare';
import { renderComparison } from './diffReport';
import { gitContext } from './git';
import { DEFAULT_PLAN, checkPlan } from './plan/check';
import { describePlanned, planSection } from './plan/plan';
import { renderPlanCheck } from './plan/report';
import { Projects } from './project';
import { renderReport } from './report';

const PLAN_FORMAT = `Plan format (markdown, saved as ${DEFAULT_PLAN} unless told otherwise):

# <what the change is for>

## \`<function name>\` in <path relative to the repo root>
- When \`<condition>\` and \`<condition>\` → throws "<part of the error message>"
- When \`<condition>\` → returns \`<returned expression>\`
- When \`<condition>\` → runs \`<statement run on that path>\`
- Always → returns \`<expression>\`
- Not: when \`<condition>\` → throws "<message>"      (a behavior that must NOT exist)

Conditions in backticks are matched against the code's conditions: spacing and the order of a comparison do not
matter (\`18 > age\` = \`age < 18\`), \`age\` matches \`user.age\`, and numeric conditions match by the values they allow
(\`age === 18\` is caught by code checking \`age <= 18\`). Give \`Not:\` items a specific outcome, e.g.
\`throws "Too young"\`; a bare \`throws\` also matches unrelated errors. Lines that are not bullets are notes.`;

const WORKFLOW = `Intent Tests checks code changes against what they were meant to do, deterministically (no AI).

Recommended workflow for a change:
1. Call get_behaviors on the functions you will change to see every path through them, how callers use them, and
   which tests reach them.
2. Call draft_plan for those functions, edit the draft so it describes the INTENDED behavior after the change,
   and write it to ${DEFAULT_PLAN}. Show the plan to the user before implementing when the intent is unclear.
3. Implement the change.
4. Call check_plan. Fix every ✗ (missing behaviors, violated Not: items). For each ⚠ unplanned change, either undo
   it or, if it is deliberate, add it to the plan and tell the user. Repeat until the plan is met.
5. Call compare_behaviors for a function-by-function summary of what the change does, to include in your report.

${PLAN_FORMAT}`;

export function createServer(root: string): McpServer {
  const server = new McpServer({ name: 'intent-tests', version: '0.0.1' }, { instructions: WORKFLOW });
  const projects = new Projects();

  const text = (body: string) => ({ content: [{ type: 'text' as const, text: body }] });
  const failure = (error: unknown) => ({
    content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
    isError: true,
  });
  /** Resolves a path against the repo root and refuses anything outside it. */
  const inRoot = (file: string): string => {
    const absolute = path.resolve(root, file);
    const relative = path.relative(root, absolute);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`${file} is outside ${root}`);
    return absolute;
  };
  const relativeToRoot = (file: string) => path.relative(root, file).split(path.sep).join('/');

  server.registerTool(
    'get_behaviors',
    {
      title: 'Get function behaviors',
      description:
        'Lists every path through a function: the conditions and what happens (returns, throws, runs). With `function`, ' +
        'also shows evidence of intent (names, types, docs, git branch), how callers use it, and which tests reach it. ' +
        'Without `function`, lists all functions in the file with their behaviors.',
      inputSchema: {
        file: z.string().describe('Path to a TypeScript or JavaScript file, relative to the repo root'),
        function: z.string().optional().describe('Function name as shown by this tool, e.g. `register`, `Cart.add`, `watch › cb`'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ file, function: name }) => {
      try {
        const absolute = inRoot(file);
        const functions = analyzeSource(absolute, fs.readFileSync(absolute, 'utf8'));
        if (!name) {
          if (!functions.length) return text(`No functions found in ${file}.`);
          return text(
            functions
              .map((fn) => [`## \`${fn.name}\` (line ${fn.line + 1})`, ...fn.behaviors.map((b) => `- ${truncate(describePlanned(b), 200)}`)].join('\n'))
              .join('\n\n'),
          );
        }
        const fn = functions.find((f) => f.name === name);
        if (!fn) return failure(new Error(`No function \`${name}\` in ${file}. Functions: ${functions.map((f) => f.name).join(', ')}`));
        const project = projects.forFile(absolute, root);
        const callers = project.callersOf(absolute, fn.namePos, new Map()).map((c) => ({ ...c, fileName: relativeToRoot(c.fileName) }));
        const closest = closestTestFile(absolute, project.testFiles);
        return text(
          renderReport(fn, { file: relativeToRoot(absolute), git: await gitContext(absolute), callers, closestTest: closest && relativeToRoot(closest) }),
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    'compare_behaviors',
    {
      title: 'Compare behaviors between versions',
      description:
        'Function by function, what behavior changed between a git ref and the working tree (or another ref): added, ' +
        'removed and changed behaviors, changed module values, edits that kept behavior the same, and whether tests ' +
        'reach each changed function and were updated.',
      inputSchema: {
        base: z.string().optional().describe('Git ref to compare from. Default `HEAD` (uncommitted changes); `branch` means where this branch left main'),
        head: z.string().optional().describe('Git ref to compare to instead of the working tree'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ base, head }) => {
      try {
        return text(renderComparison(await compareBehaviors(root, base ?? 'HEAD', { head, projects })));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    'draft_plan',
    {
      title: 'Draft a plan from current code',
      description:
        `Returns a plan describing what the functions do NOW, as a starting point. Edit it to describe what they should ` +
        `do after the change, then write it to ${DEFAULT_PLAN} and run check_plan once implemented.\n\n${PLAN_FORMAT}`,
      inputSchema: {
        file: z.string().describe('Path to the file, relative to the repo root'),
        functions: z.array(z.string()).optional().describe('Function names; default all top-level functions in the file'),
        title: z.string().optional().describe('What the change is for; becomes the plan title'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ file, functions: names, title }) => {
      try {
        const absolute = inRoot(file);
        const functions = analyzeSource(absolute, fs.readFileSync(absolute, 'utf8'));
        const unknown = (names ?? []).filter((n) => !functions.some((f) => f.name === n));
        if (unknown.length) return failure(new Error(`Not found in ${file}: ${unknown.join(', ')}. Functions: ${functions.map((f) => f.name).join(', ')}`));
        const chosen = names?.length ? functions.filter((f) => names.includes(f.name)) : functions.filter((f) => !f.parent);
        return text([`# ${title ?? 'Plan'}`, '', ...chosen.map((fn) => planSection(fn, relativeToRoot(absolute)))].join('\n'));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    'check_plan',
    {
      title: 'Check the code against the plan',
      description:
        'Compares the current code with the plan: which planned behaviors are in place (with lines), which are missing ' +
        '(with the closest behavior found), which `Not:` items the code still does, and what changed since `base` that ' +
        'the plan does not mention. The first line says whether the plan is met.',
      inputSchema: {
        plan_file: z.string().optional().describe(`Plan path relative to the repo root; default ${DEFAULT_PLAN}`),
        base: z.string().optional().describe('Git ref the change started from, for finding unplanned changes; default `HEAD`'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ plan_file, base }) => {
      try {
        if (plan_file) inRoot(plan_file);
        const check = await checkPlan(root, plan_file ?? DEFAULT_PLAN, { base, projects });
        return text(`${check.passed ? 'PLAN MET' : 'PLAN NOT MET'}\n\n${renderPlanCheck(check)}`);
      } catch (error) {
        return failure(error);
      }
    },
  );

  return server;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const rootFlag = args.indexOf('--root');
  const root = path.resolve(rootFlag >= 0 && args[rootFlag + 1] ? args[rootFlag + 1] : process.cwd());
  await createServer(root).connect(new StdioServerTransport());
  console.error(`intent-tests MCP server running for ${root}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
