import { describe, expect, it } from 'vitest';
import { analyzeFile, analyzeSource } from '../src/analysis/analyze';
import { BehaviorChange, diffAnalyses, diffFiles } from '../src/analysis/diff';
import { focusOnDifference } from '../src/diffReport';

const diff = (before: string, after: string) => diffAnalyses(analyzeSource('a.ts', before), analyzeSource('a.ts', after));

const conds = (b: { conditions: { text: string }[] }) => b.conditions.map((c) => c.text).join(' && ');
function show(change: BehaviorChange): string {
  switch (change.kind) {
    case 'added':
      return `+ ${conds(change.after)} => ${change.after.outcome}`;
    case 'removed':
      return `- ${conds(change.before)} => ${change.before.outcome}`;
    case 'steps-changed':
      return `~ steps: ${change.removedSteps.join('; ')} -> ${change.addedSteps.join('; ')}`;
    case 'outcome-changed':
      return `~ ${conds(change.after)}: ${change.before.outcome} -> ${change.after.outcome}`;
    case 'conditions-changed':
      return `~ ${change.after.outcome}: ${
        change.edits?.map((e) => `${e.before} -> ${e.after}${e.boundary ? ' (boundary)' : ''}`).join(', ') ??
        `${conds(change.before)} -> ${conds(change.after)}`
      }`;
  }
}
const changesIn = (before: string, after: string) => diff(before, after).functions.flatMap((f) => f.changes.map(show));

describe('diffAnalyses', () => {
  it('reports a moved boundary on every path that depends on it', () => {
    expect(
      changesIn(
        `function check(age: number) { if (age <= 18) throw new Error('Too young'); return true; }`,
        `function check(age: number) { if (age < 18) throw new Error('Too young'); return true; }`,
      ),
    ).toEqual(['~ throws Error: "Too young": age <= 18 -> age < 18 (boundary)', '~ returns true: age > 18 -> age >= 18 (boundary)']);
  });

  it('recognizes a boundary move between two expressions, including a mirrored rewrite', () => {
    expect(
      changesIn(
        `function fits(a: string, max: number) { if (a.length > max) return false; return true; }`,
        `function fits(a: string, max: number) { if (max <= a.length) return false; return true; }`,
      ),
    ).toEqual(['~ returns false: a.length > max -> max <= a.length (boundary)', '~ returns true: a.length <= max -> max > a.length (boundary)']);
    expect(
      changesIn(
        `function f(a: number, b: number) { if (a > b) return 1; return 0; }`,
        `function f(a: number, b: number) { if (a < b) return 1; return 0; }`,
      ),
    ).toEqual(['~ returns 1: a > b -> a < b', '~ returns 0: a <= b -> a >= b']);
  });

  it('reports a new guard as an added behavior and a narrowed happy path', () => {
    expect(
      changesIn(
        `function register(user: U) { if (!user) throw new Error('User is required'); return user.name; }`,
        `function register(user: U) {
           if (!user) throw new Error('User is required');
           if (!user.email) throw new Error('Email is required');
           return user.name;
         }`,
      ),
    ).toEqual(['~ returns user.name: user -> user && user.email', '+ user && !user.email => throws Error: "Email is required"']);
  });

  it('reports a changed outcome under the same conditions', () => {
    const result = diff(
      `function find(user?: U) { if (!user) throw new Error('missing'); return user.name; }`,
      `function find(user?: U) { if (!user) return null; return user.name; }`,
    );
    expect(result.functions.flatMap((f) => f.changes.map(show))).toEqual(['~ !user: throws Error: "missing" -> returns null']);
    expect(result.functions[0].unchanged).toBe(1);
  });

  it('pairs unrelated paths as added and removed rather than inventing a change', () => {
    expect(
      changesIn(
        `function f(a: boolean, b: boolean) { if (a) return true; return false; }`,
        `function f(a: boolean, b: boolean) { if (b) return true; return false; }`,
      ),
    ).toEqual(['+ b => returns true', '+ !b => returns false', '- a => returns true', '- !a => returns false']);
  });

  it('pairs behaviors that only renamed something instead of reporting them as removed and added', () => {
    // axios 140a17944a: `config.socketPath` became a local `socketPath` throughout.
    expect(
      changesIn(
        `function send(config: C) { if (config.socketPath && typeof config.socketPath !== 'string') return fail(config.socketPath); return go(); }`,
        `function send(config: C) { const socketPath = own('socketPath'); if (socketPath && typeof socketPath !== 'string') return fail(socketPath); return go(); }`,
      ),
    ).toEqual([
      "~ returns fail(socketPath): config.socketPath && typeof config.socketPath !== 'string' -> socketPath && typeof socketPath !== 'string'",
      "~ returns go(): !(config.socketPath && typeof config.socketPath !== 'string') -> !(socketPath && typeof socketPath !== 'string')",
    ]);
  });

  it('reports added and removed functions', () => {
    const result = diff(`function a() { return 1; }`, `function b(x: boolean) { return x ? 1 : 2; }`);
    expect(result.functions.map((f) => [f.name, f.status, f.changes.length])).toEqual([
      ['b', 'added', 2],
      ['a', 'removed', 1],
    ]);
  });

  it('separates edits that only touch comments, formatting and types', () => {
    const result = diff(
      `function check(age: number) { const min = 18; if (age < min) throw new Error('Too young'); return true; }`,
      `function check(age: number): boolean {
         // Legal minimum.
         const min: number = 18
         if (age < min) throw new Error('Too young')
         return true
       }`,
    );
    expect(result.functions).toEqual([]);
    expect(result.editedWithoutBehaviorChange).toEqual(['check']);
  });

  it('reports a changed computation even when conditions and the returned expression look the same', () => {
    // zod 2125d30ce5: the tolerance changed, the `return` line did not.
    const before = `function rem(val: number, step: number) {
      const ratio = val / step;
      const tolerance = Number.EPSILON * Math.max(Math.abs(ratio), 1);
      if (Math.abs(ratio - Math.round(ratio)) < tolerance) return 0;
      return ratio - Math.round(ratio);
    }`;
    expect(changesIn(before, before.replace('const tolerance = ', 'const tolerance = 4 * '))).toEqual([
      '~ steps: const tolerance = Number.EPSILON * Math.max(Math.abs(ratio), 1) -> const tolerance = 4 * Number.EPSILON * Math.max(Math.abs(ratio), 1)',
      '~ steps: const tolerance = Number.EPSILON * Math.max(Math.abs(ratio), 1) -> const tolerance = 4 * Number.EPSILON * Math.max(Math.abs(ratio), 1)',
    ]);
  });

  it('reports a change inside a callback', () => {
    // date-fns 9ac551ce5c: `.sort()` → `.sort((a, b) => a - b)`.
    expect(
      changesIn(
        `function overlap(a: number[], b: number[]) { const [s, e] = [...a].sort(); return s < e; }`,
        `function overlap(a: number[], b: number[]) { const [s, e] = [...a].sort((x, y) => x - y); return s < e; }`,
      ),
    ).toEqual(['~ steps: const [s, e] = [...a].sort() -> const [s, e] = [...a].sort((x, y) => x - y)']);
  });

  it('reports a changed module value and the functions reading it', () => {
    // zod 9d5b20ef6c: only the regex constant changed.
    const result = diffFiles(
      analyzeFile('a.ts', `export const ulid = /^[0-9A-Z]{26}$/;\nexport function isUlid(s: string) { return ulid.test(s); }`),
      analyzeFile('a.ts', `export const ulid = /^[0-7][0-9A-Z]{25}$/;\nexport function isUlid(s: string) { return ulid.test(s); }`),
    );
    expect(result.valuesChanged).toEqual([
      { name: 'ulid', before: '/^[0-9A-Z]{26}$/', after: '/^[0-7][0-9A-Z]{25}$/', usedBy: ['isUlid'], exported: true },
    ]);
  });

  it('finds behaviors in an anonymous default export', () => {
    expect(changesIn(`export default (key: string) => { if (!key) return; store(key); };`, `export default (key: string) => { if (!key) return; save(key); };`)).toEqual([
      '~ steps: store(key) -> save(key)',
    ]);
  });

  it('notices a change late in a long return value, and shows just that part', () => {
    const fields = 'id: user.id, name: user.name, email: user.email, createdAt: user.createdAt, ';
    const result = diff(
      `function toDto(user: User) { return { ${fields}role: user.role }; }`,
      `function toDto(user: User) { return { ${fields}role: 'admin' }; }`,
    );
    const [change] = result.functions[0].changes;
    expect(change.kind).toBe('outcome-changed');
    if (change.kind !== 'outcome-changed') return;
    expect(focusOnDifference(change.before.outcome, change.after.outcome)).toEqual([
      '…user.createdAt, role: user.role }',
      "…user.createdAt, role: 'admin' }",
    ]);
  });

  it('shows each rewritten step at the point where it changed', async () => {
    // date-fns 9ac551ce5c: two long steps changed past the 80th character.
    const step = (side: string, sort: string) =>
      `const [${side}Start, ${side}End] = [+toDate(interval${side}.start), +toDate(interval${side}.end)].sort(${sort});`;
    const body = (sort: string) => `function overlap(intervalLeft: I, intervalRight: I) { ${step('Left', sort)} ${step('Right', sort)} return LeftStart < RightEnd; }`;
    const { renderComparison } = await import('../src/diffReport');
    const report = renderComparison({
      root: '/r',
      base: { ref: 'a', label: 'a' },
      files: [{ file: 'a.ts', ...diffAnalyses(analyzeSource('a.ts', body('')), analyzeSource('a.ts', body('(a, b) => a - b'))) }],
      testFilesChanged: [],
    });
    expect(report).toContain('.sort()` → `…');
    expect(report.match(/\.sort\(\(a, b\) => a - b\)/g)).toHaveLength(2);
    expect(report).not.toContain('……');
  });

  it('surfaces mismatches the change introduced', () => {
    const result = diff(
      `function check(age: number) { if (age < 18) throw new Error('Age must be at least 18'); return true; }`,
      `function check(age: number) { if (age <= 18) throw new Error('Age must be at least 18'); return true; }`,
    );
    expect(result.functions[0].newMismatches).toHaveLength(1);
  });
});
