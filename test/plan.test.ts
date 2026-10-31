import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { analyzeSource } from '../src/analysis/analyze';
import { checkPlan } from '../src/plan/check';
import { itemMatches, parseItem, parsePlan, planSection } from '../src/plan/plan';
import { renderPlanCheck } from '../src/plan/report';

describe('parsePlan', () => {
  it('reads sections, items, and ignores notes', () => {
    const plan = parsePlan(`# Allow 18-year-olds

Some context for the agent.

## \`register\` in src/signup.ts
- When \`user.age < 18\` → throws "Age must be at least 18"
- Not: when \`user.age === 18\` -> throws
- Always → returns \`user.name\`
- a note without any code or outcome

## \`Cart.add\`
- runs \`this.items.push(item)\`
`);
    expect(plan.title).toBe('Allow 18-year-olds');
    expect(plan.sections.map((s) => [s.functionName, s.file, s.items.length])).toEqual([
      ['register', 'src/signup.ts', 3],
      ['Cart.add', undefined, 1],
    ]);
    expect(plan.sections[0].items).toMatchObject([
      { negated: false, conditions: ['user.age < 18'], kind: 'throw', message: 'Age must be at least 18', fragments: [] },
      { negated: true, conditions: ['user.age === 18'], kind: 'throw', fragments: [] },
      { negated: false, conditions: [], kind: 'return', fragments: ['user.name'] },
    ]);
  });
});

describe('itemMatches', () => {
  const [fn] = analyzeSource(
    'a.ts',
    `function register(user: User) {
       if (!user) throw new Error('User is required');
       if (user.age < 18) throw new RangeError('Age must be at least 18');
       audit(user);
       return user.name;
     }`,
  );
  const matching = (text: string) => fn.behaviors.filter((b) => itemMatches(parseItem(text)!, b)).map((b) => b.outcome);

  it.each([
    ['When `user.age < 18` → throws "at least 18"', 'the condition and part of the message'],
    ['When `18 > user.age` → throws', 'a mirrored comparison'],
    ['When `age < 18` → throws', 'a field named without its object'],
    ['When `user.age<18` → throws', 'different spacing'],
  ])('%s matches (%s)', (text) => {
    expect(matching(text)).toEqual(['throws RangeError: "Age must be at least 18"']);
  });

  it('matches a returned value exactly and a step anywhere on the path', () => {
    expect(matching('Always → returns `user.name`')).toEqual(['returns user.name']);
    expect(matching('Always → returns `user`')).toEqual([]);
    expect(matching('When `user.age >= 18` → runs `audit(user)`')).toEqual(['returns user.name']);
  });

  it('matches by what numbers take the path, not only by text', () => {
    // 17 throws, so "age 17 throws" is in place; 18 does not, so "age 18 throws" is not.
    expect(matching('When `user.age === 17` → throws')).toEqual(['throws RangeError: "Age must be at least 18"']);
    expect(matching('When `user.age === 18` → throws')).toEqual([]);
    expect(matching('When `user.age < 10` → throws')).toEqual(['throws RangeError: "Age must be at least 18"']);
    expect(matching('When `user.age <= 18` → throws')).toEqual([]);
  });

  it('does not match the wrong boundary or outcome', () => {
    expect(matching('When `user.age < 21` → throws')).toEqual([]);
    expect(matching('When `user.age < 18` → returns `false`')).toEqual([]);
    expect(matching('When `user.age < 18` → throws "at least 21"')).toEqual([]);
  });

  it('round-trips: a plan generated from the code matches every behavior of it', () => {
    const plan = parsePlan(planSection(fn, 'a.ts'));
    expect(plan.sections[0].items.map((item) => fn.behaviors.filter((b) => itemMatches(item, b)).length)).toEqual([1, 1, 1]);
  });
});

describe('checkPlan', () => {
  let repo: string;
  const write = (file: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    fs.writeFileSync(path.join(repo, file), text);
  };
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { cwd: repo });

  beforeAll(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'intent-plan-'));
    git('init', '-q', '-b', 'main');
    write('src/signup.ts', `export function register(user: User) {\n  if (!user) throw new Error('User is required');\n  if (user.age <= 18) throw new RangeError('Too young');\n  return user.name;\n}\n`);
    write('src/format.ts', `export function title(s: string) {\n  return s.toUpperCase();\n}\n`);
    git('add', '-A');
    git('commit', '-q', '-m', 'initial');

    // The plan: accept 18-year-olds, require an email.
    write(
      '.intent/plan.md',
      `# Allow 18-year-olds, require email

## \`register\` in src/signup.ts
- When \`!user\` → throws "User is required"
- When \`user.age < 18\` → throws "Too young"
- Not: when \`user.age === 18\` → throws "Too young"
- When \`!user.email\` → throws "Email is required"
- Always → returns \`user.name\`
`,
    );
    // The "agent's" attempt: fixed the boundary, got the email message wrong, added an unplanned check, touched another file.
    write(
      'src/signup.ts',
      `export function register(user: User) {\n  if (!user) throw new Error('User is required');\n  if (user.age < 18) throw new RangeError('Too young');\n  if (!user.email) throw new Error('Email required');\n  if (user.age > 150) throw new RangeError('Too old');\n  return user.name;\n}\n`,
    );
    write('src/format.ts', `export function title(s: string) {\n  return s.trim().toUpperCase();\n}\n`);
  });

  afterAll(() => fs.rmSync(repo, { recursive: true, force: true }));

  it('reports what is in place, what is missing, and what was not planned', async () => {
    const check = await checkPlan(repo);
    expect(check.passed).toBe(false);
    const [register] = check.sections;
    expect(register.items.map((r) => r.status)).toEqual(['found', 'found', 'absent', 'missing', 'found']);
    expect(register.items[3].behaviors[0].throwMessage).toBe('Email required');
    expect(register.unplanned.map((u) => [u.change, u.behavior.outcome])).toEqual([['added', 'throws RangeError: "Too old"']]);
    expect(check.unplannedFunctions).toEqual([{ file: 'src/format.ts', name: 'title', changes: 1 }]);

    const report = renderPlanCheck(check);
    expect(report).toContain('✗ Plan not met');
    expect(report).toContain('Closest: When `user` and `user.age >= 18` and `!user.email` → throws "Email required"');
    expect(report).toContain('⚠ Added, not in the plan: When');
    expect(report).toContain('`title` in src/format.ts — 1 behavior change');
  }, 30000);

  it('catches a `Not:` item the code still does, even when written differently', async () => {
    const original = fs.readFileSync(path.join(repo, 'src/signup.ts'), 'utf8');
    // The boundary was not fixed: 18 is still rejected by `<= 18`.
    write('src/signup.ts', original.replace('user.age < 18', 'user.age <= 18'));
    const check = await checkPlan(repo);
    expect(check.sections[0].items.map((r) => r.status)).toEqual(['found', 'found', 'violated', 'missing', 'found']);
    expect(renderPlanCheck(check)).toContain('✗ Not: when `user.age === 18` → throws "Too young" — but the code does this _(line 3)_');
    write('src/signup.ts', original);
  }, 30000);

  it('passes once the code matches the plan', async () => {
    write(
      'src/signup.ts',
      `export function register(user: User) {\n  if (!user) throw new Error('User is required');\n  if (user.age < 18) throw new RangeError('Too young');\n  if (!user.email) throw new Error('Email is required');\n  return user.name;\n}\n`,
    );
    const check = await checkPlan(repo);
    expect(check.sections[0].items.every((r) => r.status === 'found' || r.status === 'absent')).toBe(true);
    expect(check.passed).toBe(true);
  }, 30000);

  it('explains a missing plan file', async () => {
    await expect(checkPlan(repo, '.intent/other.md')).rejects.toThrow('No plan at .intent/other.md');
  });
});
