import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compareBehaviors } from '../src/compare';
import { renderComparison } from '../src/diffReport';

let repo: string;

function write(file: string, text: string) {
  fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
  fs.writeFileSync(path.join(repo, file), text);
}

function git(...args: string[]) {
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { cwd: repo });
}

beforeAll(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'intent-tests-'));
  git('init', '-q', '-b', 'main');
  write(
    'src/signup.ts',
    `export function register(age: number) {\n  if (age <= 18) throw new Error('Too young');\n  return true;\n}\n`,
  );
  write(
    'src/signup.test.ts',
    `import { register } from './signup';\nit('accepts adults', () => { expect(register(30)).toBe(true); });\n`,
  );
  git('add', '-A');
  git('commit', '-q', '-m', 'initial');

  // The "agent's" change: fix the boundary; add a discount that is only tested through checkout; add dead code.
  write(
    'src/signup.ts',
    `export function register(age: number) {\n  if (age < 18) throw new Error('Too young');\n  return true;\n}\n`,
  );
  write('src/discount.ts', `export const discount = (total: number) => total > 100 ? 0.1 : 0;\n`);
  write(
    'src/checkout.ts',
    `import { discount } from './discount';\nexport function checkout(total: number) {\n  return total * (1 - discount(total));\n}\n`,
  );
  write(
    'src/checkout.test.ts',
    `import { checkout } from './checkout';\nit('discounts big orders', () => { expect(checkout(200)).toBe(180); });\n`,
  );
  write('src/legacy.ts', `export const oldRate = (x: number) => x > 1 ? 1 : 0;\n`);
});

afterAll(() => fs.rmSync(repo, { recursive: true, force: true }));

describe('compareBehaviors', () => {
  it('compares the working tree with the last commit, including untracked files and their tests', async () => {
    const result = await compareBehaviors(repo, 'HEAD');
    const byFile = Object.fromEntries(result.files.map((f) => [f.file, f.functions]));

    expect(Object.keys(byFile).sort()).toEqual(['src/checkout.ts', 'src/discount.ts', 'src/legacy.ts', 'src/signup.ts']);
    expect(result.testFilesChanged).toEqual(['src/checkout.test.ts']);
    expect(byFile['src/signup.ts'][0]).toMatchObject({
      name: 'register',
      status: 'changed',
      tests: { count: 1, direct: 1, files: ['src/signup.test.ts'], touched: false },
    });
    expect(byFile['src/discount.ts'][0]).toMatchObject({
      name: 'discount',
      status: 'added',
      tests: { count: 1, direct: 0, via: ['checkout'], files: ['src/checkout.test.ts'], touched: true },
    });
    expect(byFile['src/legacy.ts'][0]).toMatchObject({ name: 'oldRate', tests: { count: 0 } });

    const report = renderComparison(result);
    expect(report).toContain('(boundary moved)');
    expect(report).toContain('1 test reach it only indirectly, via `checkout`');
    expect(report).toContain('⚠ 1 function with behavior changes is not reached by any test');
    expect(report).toContain('⚠ 1 function changed behavior but its tests were not updated');
  }, 30000);

  it('rejects unknown refs', async () => {
    await expect(compareBehaviors(repo, 'no-such-branch')).rejects.toThrow('Could not find git ref "no-such-branch"');
  });
});
