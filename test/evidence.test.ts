import { describe, expect, it } from 'vitest';
import { analyzeSource } from '../src/analysis/analyze';
import { docOf, parseBranchName, splitIdentifier } from '../src/analysis/evidence';

describe('docOf', () => {
  it('reads JSDoc from a const arrow function', () => {
    const [fn] = analyzeSource(
      'sample.ts',
      `/**
        * Checks whether a user can sign up.
        * @param age - age in whole years
        * @throws RangeError when age is negative
        */
       export const canSignUp = (age: number) => age >= 18;`,
    );
    expect(docOf(fn)).toEqual({
      summary: 'Checks whether a user can sign up.',
      tags: [
        { name: 'param', text: 'age - age in whole years' },
        { name: 'throws', text: 'RangeError when age is negative' },
      ],
    });
  });
});

describe('splitIdentifier', () => {
  it.each([
    ['isAdult', ['is', 'adult']],
    ['Cart.addItem', ['cart', 'add', 'item']],
    ['parseURL', ['parse', 'url']],
    ['max_retry_count2', ['max', 'retry', 'count', '2']],
  ])('%s', (name, words) => expect(splitIdentifier(name)).toEqual(words));
});

describe('parseBranchName', () => {
  it('extracts the ticket and summary', () => {
    expect(parseBranchName('feature/proj-123-allow-18-year-olds')).toEqual({ ticket: 'PROJ-123', summary: 'allow 18 year olds' });
  });

  it('handles branches without a ticket', () => {
    expect(parseBranchName('fix/age-boundary')).toEqual({ ticket: undefined, summary: 'age boundary' });
  });

  it('ignores trunk branches', () => {
    expect(parseBranchName('main')).toBeUndefined();
  });
});
