import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from '../src/mcp';

let repo: string;
let client: Client;

const write = (file: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
  fs.writeFileSync(path.join(repo, file), text);
};

async function call(name: string, args: Record<string, unknown> = {}): Promise<{ text: string; isError: boolean }> {
  const result = (await client.callTool({ name, arguments: args })) as { content: { type: string; text: string }[]; isError?: boolean };
  return { text: result.content.map((c) => c.text).join('\n'), isError: !!result.isError };
}

beforeAll(async () => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'intent-mcp-'));
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { cwd: repo });
  git('init', '-q', '-b', 'main');
  write('src/signup.ts', `export function register(age: number) {\n  if (age <= 18) throw new RangeError('Too young');\n  return true;\n}\n`);
  write('src/signup.test.ts', `import { register } from './signup';\nit('accepts adults', () => { expect(register(30)).toBe(true); });\n`);
  git('add', '-A');
  git('commit', '-q', '-m', 'initial');

  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createServer(repo).connect(serverSide);
  client = new Client({ name: 'test-agent', version: '1.0.0' });
  await client.connect(clientSide);
});

afterAll(async () => {
  await client.close();
  fs.rmSync(repo, { recursive: true, force: true });
});

describe('MCP server', () => {
  it('offers four read-only tools and explains the workflow', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['check_plan', 'compare_behaviors', 'draft_plan', 'get_behaviors']);
    expect(tools.every((t) => t.annotations?.readOnlyHint)).toBe(true);
    expect(client.getInstructions()).toContain('Call check_plan');
  });

  it('runs the whole workflow: behaviors, draft, check against the plan, compare', async () => {
    const behaviors = await call('get_behaviors', { file: 'src/signup.ts', function: 'register' });
    expect(behaviors.text).toContain('**When** `age <= 18` → throws RangeError: "Too young"');
    expect(behaviors.text).toContain('"accepts adults"');

    const draft = await call('draft_plan', { file: 'src/signup.ts', functions: ['register'], title: 'Allow 18-year-olds' });
    expect(draft.text).toBe(
      '# Allow 18-year-olds\n\n## `register` in src/signup.ts\n\n- When `age <= 18` → throws "Too young"\n- When `age > 18` → returns `true`\n',
    );

    // The agent edits the draft into the intended behavior and saves it, then checks before implementing.
    write('.intent/plan.md', '# Allow 18-year-olds\n\n## `register` in src/signup.ts\n- When `age < 18` → throws "Too young"\n- Not: when `age === 18` → throws "Too young"\n- When `age >= 18` → returns `true`\n');
    const before = await call('check_plan');
    expect(before.text.split('\n')[0]).toBe('PLAN NOT MET');
    expect(before.text).toContain('✗ Not: when `age === 18` → throws "Too young" — but the code does this');

    // The agent implements it.
    write('src/signup.ts', `export function register(age: number) {\n  if (age < 18) throw new RangeError('Too young');\n  return true;\n}\n`);
    const after = await call('check_plan');
    expect(after.text.split('\n')[0]).toBe('PLAN MET');

    const summary = await call('compare_behaviors');
    expect(summary.text).toContain('(boundary moved)');
    expect(summary.text).toContain('none updated in this change');
  }, 30000);

  it('lists every function when no function is given', async () => {
    expect((await call('get_behaviors', { file: 'src/signup.ts' })).text).toContain('## `register` (line 1)');
  });

  it('returns errors as tool errors, and refuses paths outside the repo', async () => {
    expect(await call('get_behaviors', { file: 'src/signup.ts', function: 'nope' })).toMatchObject({ isError: true });
    const outside = await call('get_behaviors', { file: '../../etc/passwd' });
    expect(outside.isError).toBe(true);
    expect(outside.text).toContain('is outside');
    expect((await call('check_plan', { plan_file: '.intent/missing.md' })).text).toContain('No plan at .intent/missing.md');
  });
});
