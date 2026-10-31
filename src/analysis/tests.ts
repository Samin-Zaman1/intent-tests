/** `a.test.ts`, `a.spec.ts`, a file named `test.ts` (date-fns style), or anything under `__tests__/`, `test/`, `tests/`. */
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$|(^|[\\/])(test|spec)\.[cm]?[jt]sx?$|(^|[\\/])(__tests__|__mocks__|tests?|specs?)[\\/]/;

export function isTestFile(fileName: string): boolean {
  return TEST_FILE.test(fileName);
}

/** `src/user/signup.ts` → `signup`; `src/__tests__/signup.test.ts` → `signup`. */
function stem(fileName: string): string {
  const base = fileName.slice(fileName.lastIndexOf('/') + 1);
  return base.replace(/\.[cm]?[jt]sx?$/, '').replace(/\.(test|spec)$/, '');
}

function dirs(fileName: string): string[] {
  return fileName.split('/').slice(0, -1);
}

/**
 * The test file a new test for `sourceFile` most likely belongs in, or the nearest one to copy conventions from:
 * a file for the same module wins, then whichever is fewest folders away.
 */
export function closestTestFile(sourceFile: string, testFiles: string[]): string | undefined {
  const source = sourceFile.replace(/\\/g, '/');
  const sourceDirs = dirs(source);
  let best: { file: string; score: number } | undefined;
  for (const file of testFiles) {
    const test = file.replace(/\\/g, '/');
    const testDirs = dirs(test);
    let common = 0;
    while (common < sourceDirs.length && common < testDirs.length && sourceDirs[common].toLowerCase() === testDirs[common].toLowerCase()) {
      common++;
    }
    const distance = sourceDirs.length - common + (testDirs.length - common);
    const score = (stem(test) === stem(source) ? 0 : 1000) + distance;
    if (!best || score < best.score) best = { file, score };
  }
  return best?.file;
}
