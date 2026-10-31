import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { analyzeSource } from '../src/analysis/analyze';
import { findCallSites } from '../src/analysis/callers';
import { createLanguageService } from '../src/analysis/project';
import { closestTestFile, isTestFile } from '../src/analysis/tests';

const FILES: Record<string, string> = {
  '/proj/src/signup.ts': `
    export function register(user?: { age: number; name: string }) {
      if (!user) throw new Error('User is required');
      return user.name;
    }
    export function findUser(id: string): { name: string } | null { return null; }
    export class Account { constructor(public owner: string) {} }
  `,
  '/proj/src/app.ts': `
    import { register, findUser, Account } from './signup';
    export function onSubmit() {
      try { register({ age: 17, name: 'Ana' }); } catch (e) { console.error(e); }
    }
    export function greet(id: string) {
      const user = findUser(id);
      if (!user) return 'Who?';
      return user.name;
    }
    export const label = (id: string) => findUser(id)?.name ?? 'anon';
    export const open = () => new Account('Ana');
  `,
  '/proj/src/signup.test.ts': `
    import { describe, it, expect } from 'vitest';
    import { register } from './signup';
    describe('register', () => {
      it('returns the name', () => {
        expect(register({ age: 30, name: 'Bo' })).toBe('Bo');
      });
      it('requires a user', () => {
        expect(() => register()).toThrow('User is required');
      });
    });
  `,
};

const service = createLanguageService({
  root: '/proj',
  compilerOptions: { target: ts.ScriptTarget.Latest, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, types: [] },
  rootFiles: () => Object.keys(FILES),
  read: (fileName) => {
    const text = FILES[fileName.replace(/\\/g, '/')] ?? (ts.sys.fileExists(fileName) ? ts.sys.readFile(fileName) : undefined);
    return text === undefined ? undefined : { version: '1', text };
  },
  directoryExists: (dirName) => dirName.replace(/\\/g, '/').startsWith('/proj') || ts.sys.directoryExists(dirName),
});

function callersOf(name: string) {
  const fn = analyzeSource('/proj/src/signup.ts', FILES['/proj/src/signup.ts']).find((f) => f.name === name)!;
  return findCallSites(service, '/proj/src/signup.ts', fn.namePos);
}

describe('findCallSites', () => {
  it('sees error handling and literal arguments at a production call site', () => {
    const [site] = callersOf('register').filter((c) => !c.isTest);
    expect(site).toMatchObject({
      fileName: '/proj/src/app.ts',
      handlesErrors: true,
      resultUse: 'ignored',
      args: ["{ age: 17, name: 'Ana' }"],
    });
  });

  it('reads test names and assertions from existing tests', () => {
    const tests = callersOf('register').filter((c) => c.isTest);
    expect(tests.map((t) => [t.testName, t.assertion])).toEqual([
      ['register › returns the name', "expect(register({ age: 30, name: 'Bo' })).toBe('Bo')"],
      ['register › requires a user', "expect(() => register()).toThrow('User is required')"],
    ]);
  });

  it('notices callers that guard against a null result, directly or through a variable', () => {
    expect(callersOf('findUser').map((c) => [c.args, c.resultUse])).toEqual([
      [[undefined], 'null-checked'],
      [[undefined], 'null-checked'],
    ]);
  });

  it('finds constructor calls through the class name', () => {
    expect(callersOf('Account.constructor').map((c) => c.args)).toEqual([["'Ana'"]]);
  });
});

describe('test files', () => {
  it.each(['src/a.test.ts', 'src/a.spec.tsx', 'src/__tests__/a.ts', 'lib/a.test.mjs', 'src/addDays/test.ts', 'test/utils.ts', 'packages/x/tests/a.ts'])(
    '%s is a test file',
    (f) => expect(isTestFile(f)).toBe(true),
  );

  it.each(['src/testing.ts', 'src/latest/a.ts', 'src/contest.ts'])('%s is not a test file', (f) => expect(isTestFile(f)).toBe(false));

  it('prefers a test for the same module, then the nearest folder', () => {
    const tests = ['/p/test/other.test.ts', '/p/src/user/__tests__/signup.test.ts', '/p/src/user/profile.test.ts'];
    expect(closestTestFile('/p/src/user/signup.ts', tests)).toBe('/p/src/user/__tests__/signup.test.ts');
    expect(closestTestFile('/p/src/user/login.ts', tests)).toBe('/p/src/user/profile.test.ts');
    expect(closestTestFile('C:\\p\\src\\user\\login.ts', ['C:/p/test/other.test.ts', 'C:/p/src/user/profile.test.ts'])).toBe(
      'C:/p/src/user/profile.test.ts',
    );
  });
});
