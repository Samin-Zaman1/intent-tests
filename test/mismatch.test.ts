import { describe, expect, it } from 'vitest';
import { analyzeSource } from '../src/analysis/analyze';
import { parseRule } from '../src/analysis/mismatch';

const mismatchesIn = (body: string) =>
  analyzeSource('sample.ts', `function f(age: number, qty: number) {\n${body}\nreturn true;\n}`)[0].mismatches;

describe('parseRule', () => {
  it.each([
    ['Age must be at least 18', '<', 18],
    ['Must be 18 or older', '<', 18],
    ['Quantity must be at most 100', '>', 100],
    ['Quantity cannot be more than 100', '>', 100],
    ['No more than 5 items allowed', '>', 5],
    ['Users under 18 are not allowed', '<', 18],
    ['Must be over 21', '<=', 21],
    ['Value must be less than 10', '>=', 10],
  ])('"%s" rejects values %s %d', (message, rejected, value) => {
    expect(parseRule(message)).toMatchObject({ rejected, value });
  });

  it('ignores messages without a numeric bound', () => {
    expect(parseRule('User is required')).toBeUndefined();
  });
});

describe('findMismatches', () => {
  it('flags an off-by-one between the message and the guard', () => {
    const [m] = mismatchesIn(`if (age <= 18) throw new Error('Age must be at least 18');`);
    expect(m.line).toBe(1);
    expect(m.explanation).toContain('age = 18 should be accepted');
    expect(m.explanation).toContain('off-by-one');
  });

  it('flags an inverted comparison', () => {
    const [m] = mismatchesIn(`if (age > 18) throw new Error('Must be at least 18');`);
    expect(m.explanation).toContain('inverted');
  });

  it.each([
    `if (age < 18) throw new Error('Age must be at least 18');`,
    `if (18 > age) throw new Error('Age must be at least 18');`,
    `if (!(age >= 18)) throw new Error('Age must be at least 18');`,
    `if (age >= 18) { ok(); } else { throw new Error('Age must be at least 18'); }`,
    `if (qty > 100) throw new Error('Quantity cannot be more than 100');`,
    `if (age < 21) throw new Error('Age must be at least 18');`,
    `if (age < 18) throw new Error(\`Age \${age} is too low\`);`,
  ])('stays quiet when code and message agree or are unrelated: %s', (body) => {
    expect(mismatchesIn(body)).toEqual([]);
  });

  it('flags a stated maximum checked with the wrong strictness', () => {
    const [m] = mismatchesIn(`if (qty >= 100) throw new Error('Quantity cannot be more than 100');`);
    expect(m.explanation).toContain('qty = 100 should be accepted');
  });
});
