import { describe, expect, it } from 'vitest';
import { analyzeSource } from '../src/analysis/analyze';
import { diffAnalyses } from '../src/analysis/diff';
import { FIX_SUBJECT, isIdentifierOnly, shape, smallFix } from '../src/eval/metrics';

describe('commit selection', () => {
  it.each(['fix(runtime-core): handle null props', 'Fixes #123: wrong offset', 'fix: off-by-one in range', 'Handle edge case for empty input'])(
    '"%s" looks like a fix',
    (subject) => expect(FIX_SUBJECT.test(subject)).toBe(true),
  );

  it.each(['feat: add retry option', 'chore(deps): bump vitest', 'docs: prefix the README'])('"%s" does not', (subject) =>
    expect(FIX_SUBJECT.test(subject)).toBe(false),
  );

  it('keeps small source-only fixes and ignores tests, docs and type declarations', () => {
    expect(
      smallFix([
        { file: 'src/range.ts', added: 3, removed: 1 },
        { file: 'src/range.test.ts', added: 40, removed: 0 },
        { file: 'docs/range.md', added: 5, removed: 0 },
        { file: 'src/types.d.ts', added: 2, removed: 0 },
      ]),
    ).toEqual({ sourceFiles: 1, linesChanged: 4 });
    expect(smallFix([{ file: 'src/a.ts', added: 50, removed: 20 }])).toBeUndefined();
    expect(smallFix([{ file: 'README.md', added: 1, removed: 1 }])).toBeUndefined();
  });
});

describe('identifier-only changes', () => {
  it('keeps string contents and operators, replaces names', () => {
    expect(shape(`user.age >= 18 => throws Error: "Too young"`)).toBe(`_._ >= 18 => throws _: "Too young"`);
  });

  const change = (before: string, after: string) =>
    diffAnalyses(analyzeSource('a.ts', before), analyzeSource('a.ts', after)).functions[0].changes[0];

  it('flags a rename', () => {
    expect(isIdentifierOnly(change(`function f(a: Order) { if (a.n > 1) return a.total; return 0; }`, `function f(a: Order) { if (a.n > 1) return a.sum; return 0; }`))).toBe(true);
  });

  it('does not flag a real change', () => {
    expect(isIdentifierOnly(change(`function f(a: number) { if (a > 1) return a; return 0; }`, `function f(a: number) { if (a > 1) return a; return -1; }`))).toBe(false);
  });
});
