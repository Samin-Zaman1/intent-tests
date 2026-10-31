import { describe, expect, it } from 'vitest';
import { analyzeSource } from '../src/analysis/analyze';
import { BehaviorChange, diffAnalyses } from '../src/analysis/diff';
import { focusOnDifference } from '../src/diffReport';

const diff = (before: string, after: string) => diffAnalyses(analyzeSource('a.ts', before), analyzeSource('a.ts', after));

const conds = (b: { conditions: { text: string }[] }) => b.conditions.map((c) => c.text).join(' && ');
function show(change: BehaviorChange): string {
  switch (change.kind) {
    case 'added':
      return `+ ${conds(change.after)} => ${change.after.outcome}`;
    case 'removed':
      return `- ${conds(change.before)} => ${change.before.outcome}`;
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

  it('reports added and removed functions', () => {
    const result = diff(`function a() { return 1; }`, `function b(x: boolean) { return x ? 1 : 2; }`);
    expect(result.functions.map((f) => [f.name, f.status, f.changes.length])).toEqual([
      ['b', 'added', 2],
      ['a', 'removed', 1],
    ]);
  });

  it('separates edits that keep behavior the same', () => {
    const result = diff(
      `function check(age: number) { if (age < 18) throw new Error('Too young'); return true; }`,
      `function check(age: number) {
         logger.debug('checking age', age);
         if (age < 18) throw new Error('Too young');
         return true;
       }`,
    );
    expect(result.functions).toEqual([]);
    expect(result.editedWithoutBehaviorChange).toEqual(['check']);
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

  it('surfaces mismatches the change introduced', () => {
    const result = diff(
      `function check(age: number) { if (age < 18) throw new Error('Age must be at least 18'); return true; }`,
      `function check(age: number) { if (age <= 18) throw new Error('Age must be at least 18'); return true; }`,
    );
    expect(result.functions[0].newMismatches).toHaveLength(1);
  });
});
