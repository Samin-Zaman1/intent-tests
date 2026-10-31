import { describe, expect, it } from 'vitest';
import { analyzeSource } from '../src/analysis/analyze';

const analyze = (code: string) => analyzeSource('sample.ts', code);
const summarize = (code: string, index = 0) =>
  analyze(code)[index].behaviors.map((b) => `${b.conditions.map((c) => c.text).join(' && ') || 'always'} => ${b.outcome}`);

describe('collectBehaviors', () => {
  it('splits guard clauses into one behavior per exit, carrying the negated guards forward', () => {
    expect(
      summarize(`
        function register(user?: User) {
          if (!user) throw new Error('User is required');
          if (user.age < 18) throw new RangeError('Age must be at least 18');
          return user.name;
        }`),
    ).toEqual([
      '!user => throws Error: "User is required"',
      'user && user.age < 18 => throws RangeError: "Age must be at least 18"',
      'user && user.age >= 18 => returns user.name',
    ]);
  });

  it('splits nested ternaries in a concise arrow function', () => {
    expect(summarize(`const sign = (n: number) => n > 0 ? 'positive' : n < 0 ? 'negative' : 'zero';`)).toEqual([
      "n > 0 => returns 'positive'",
      "n <= 0 && n < 0 => returns 'negative'",
      "n <= 0 && n >= 0 => returns 'zero'",
    ]);
  });

  it('groups fall-through switch cases and knows a default makes the switch exhaustive', () => {
    expect(
      summarize(`
        function weight(s: Size) {
          switch (s) {
            case 'S':
            case 'M': return 1;
            default: return 2;
          }
        }`),
    ).toEqual(["s === 'S' || s === 'M' => returns 1", 's matches no case => returns 2']);
  });

  it('records if/else branches that do work without returning', () => {
    expect(
      summarize(`
        function save(x: number) {
          if (x > 0) { store(x); } else { log('skipped'); }
        }`),
    ).toEqual(['x > 0 => runs store(x)', "x <= 0 => runs log('skipped')", 'always => completes without returning a value']);
  });

  it('ignores type declarations nested in callbacks (immer __tests__/produce.ts crashed this once)', () => {
    const [fn] = analyze(`
      function run() {
        it(() => { type State = { readonly a: number }; const s: State = { a: 1 }; use(s as State); });
        return 1;
      }`);
    expect(fn.behaviors[0].steps).toEqual(['it(() => { const s = { a: 1 }; use(s); })']);
  });

  it('records the statements run along each path, without comments or formatting', () => {
    const [fn] = analyze(`
      function total(items: Item[]) {
        let sum = 0; // running total
        for (const item of items) sum += item.price;
        if (sum > 100) return sum * 0.9;
        return sum;
      }`);
    expect(fn.behaviors.map((b) => b.steps)).toEqual([
      ['let sum = 0', 'for (const item of items) sum += item.price'],
      ['let sum = 0', 'for (const item of items) sum += item.price'],
    ]);
  });

  it('treats an else that throws as a guard for the code after it', () => {
    expect(
      summarize(`
        function check(age: number) {
          if (age >= 18) { audit(age); } else { throw new Error('too young'); }
          return true;
        }`),
    ).toEqual(['age >= 18 => runs audit(age)', 'age < 18 => throws Error: "too young"', 'age >= 18 => returns true']);
  });

  it('records the catch path of a try block', () => {
    expect(
      summarize(`
        async function load(id: string) {
          try { return await fetchUser(id); } catch { return null; }
        }`),
    ).toEqual(['always => returns await fetchUser(id)', 'an error is thrown in the try block => returns null']);
  });
});

describe('findFunctions', () => {
  it('names class methods, property arrows, and exported consts', () => {
    const names = analyze(`
      export class Cart {
        add(item: Item) { if (!item) throw new Error('no item'); this.items.push(item); }
        total = () => this.items.length;
      }
      export const isAdult = (age: number): boolean => age >= 18;
      function outer() { function inner() {} return inner; }
    `).map((fn) => fn.name);
    expect(names).toEqual(['Cart.add', 'Cart.total', 'isAdult', 'outer']);
  });

  it('finds functions inside module-level expressions', () => {
    const names = analyze(`
      export default isSupported && function httpAdapter(config) { if (!config) throw new Error('x'); return send(config); };
      app.get('/health', (req, res) => { res.send('ok'); });
      export const handler = wrap(async () => 1);
    `).map((fn) => fn.name);
    expect(names).toEqual(['httpAdapter', 'app.get callback', 'wrap callback']);
  });

  it('captures parameter and return types', () => {
    const [fn] = analyze(`export const isAdult = (age: number): boolean => age >= 18;`);
    expect(fn.params).toEqual([{ name: 'age', type: 'number' }]);
    expect(fn.returnType).toBe('boolean');
  });
});
