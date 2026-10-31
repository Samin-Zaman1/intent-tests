import * as ts from 'typescript';
import { Condition, FunctionInfo, lineOf, unwrap } from './behaviors';

type Op = '<' | '<=' | '>' | '>=';

/** A numeric comparison on a path, normalized so the subject is on the left: `age < 18`. */
export interface Comparison {
  subject: string;
  op: Op;
  value: number;
}

/** A numeric rule stated in prose, expressed as the comparison that should be rejected. */
export interface StatedRule {
  phrase: string;
  rejected: Op;
  value: number;
}

/** A place where the code's condition disagrees with what its own error message says. */
export interface Mismatch {
  functionName: string;
  /** 0-based line of the guarding condition. */
  line: number;
  message: string;
  explanation: string;
}

const OPERATORS: Partial<Record<ts.SyntaxKind, Op>> = {
  [ts.SyntaxKind.LessThanToken]: '<',
  [ts.SyntaxKind.LessThanEqualsToken]: '<=',
  [ts.SyntaxKind.GreaterThanToken]: '>',
  [ts.SyntaxKind.GreaterThanEqualsToken]: '>=',
};
const MIRROR: Record<Op, Op> = { '<': '>', '<=': '>=', '>': '<', '>=': '<=' };
const NEGATE: Record<Op, Op> = { '<': '>=', '<=': '>', '>': '<=', '>=': '<' };

const NUM = '(-?\\d+(?:\\.\\d+)?)';
/** Phrases describing a numeric bound. Order matters: the first match wins. */
const PHRASES: { pattern: RegExp; op: Op }[] = [
  { pattern: new RegExp(`\\b(?:at least|minimum(?: of)?)\\s+${NUM}`, 'i'), op: '>=' },
  { pattern: new RegExp(`${NUM}\\s+or (?:more|greater|higher|older|above)\\b`, 'i'), op: '>=' },
  { pattern: new RegExp(`\\b(?:at most|maximum(?: of)?|up to)\\s+${NUM}`, 'i'), op: '<=' },
  { pattern: new RegExp(`${NUM}\\s+or (?:less|fewer|lower|younger|below)\\b`, 'i'), op: '<=' },
  { pattern: new RegExp(`\\b(?:more than|greater than|higher than|older than|over|above)\\s+${NUM}`, 'i'), op: '>' },
  { pattern: new RegExp(`\\b(?:less than|fewer than|lower than|younger than|under|below)\\s+${NUM}`, 'i'), op: '<' },
];
/** "cannot be less than 18" or "no more than 5": the phrase describes what is rejected. */
const NEGATION_BEFORE = /\b(?:not|no|never|cannot|can't|mustn't|isn't|aren't|shouldn't)\s+(?:be\s+)?$/i;
/** "under 18 are not allowed": the phrase describes what is rejected. */
const REJECTED_AFTER = /^\s*(?:is\s+|are\s+)?(?:not allowed|not permitted|forbidden|prohibited|rejected|invalid)/i;

export function parseRule(message: string): StatedRule | undefined {
  for (const { pattern, op } of PHRASES) {
    const match = pattern.exec(message);
    if (!match) continue;
    const before = message.slice(0, match.index);
    const after = message.slice(match.index + match[0].length);
    const describesRejected = NEGATION_BEFORE.test(before) || REJECTED_AFTER.test(after);
    return { phrase: match[0], value: Number(match[1]), rejected: describesRejected ? op : NEGATE[op] };
  }
  return undefined;
}

export function toComparison(c: Condition): Comparison | undefined {
  if (!c.expr) return undefined;
  let e = unwrap(c.expr);
  let negated = c.negated;
  while (ts.isPrefixUnaryExpression(e) && e.operator === ts.SyntaxKind.ExclamationToken) {
    negated = !negated;
    e = unwrap(e.operand);
  }
  if (!ts.isBinaryExpression(e)) return undefined;
  let op = OPERATORS[e.operatorToken.kind];
  if (!op) return undefined;
  let subject: ts.Expression = e.left;
  let value = numberOf(e.right);
  if (value === undefined) {
    value = numberOf(e.left);
    subject = e.right;
    op = MIRROR[op];
  }
  if (value === undefined || numberOf(subject) !== undefined) return undefined;
  return { subject: subject.getText().replace(/\s+/g, ' '), op: negated ? NEGATE[op] : op, value };
}

function numberOf(expr: ts.Expression): number | undefined {
  const e = unwrap(expr);
  if (ts.isNumericLiteral(e)) return Number(e.text.replace(/_/g, ''));
  if (ts.isPrefixUnaryExpression(e) && e.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(e.operand)) {
    return -Number(e.operand.text.replace(/_/g, ''));
  }
  return undefined;
}

/**
 * Compares each throw's literal message against the numeric condition guarding it.
 * Deliberately narrow: it only speaks up when the message states a bound with the same number the code checks.
 */
export function findMismatches(fn: FunctionInfo): Mismatch[] {
  const found: Mismatch[] = [];
  for (const behavior of fn.behaviors) {
    if (behavior.kind !== 'throw' || !behavior.throwMessage) continue;
    const rule = parseRule(behavior.throwMessage);
    if (!rule) continue;
    for (const condition of [...behavior.conditions].reverse()) {
      const guard = toComparison(condition);
      if (!guard || guard.value !== rule.value) continue;
      if (guard.op !== rule.rejected) {
        found.push({
          functionName: fn.name,
          line: lineOf(condition.expr!.getSourceFile(), condition.expr!.getStart()),
          message: behavior.throwMessage,
          explanation: explain(guard, rule),
        });
      }
      break;
    }
  }
  return found;
}

function holds(op: Op, x: number, value: number): boolean {
  switch (op) {
    case '<': return x < value;
    case '<=': return x <= value;
    case '>': return x > value;
    case '>=': return x >= value;
  }
}

function explain(guard: Comparison, rule: StatedRule): string {
  const { subject } = guard;
  const n = rule.value;
  if (guard.op[0] === rule.rejected[0]) {
    const shouldThrow = holds(rule.rejected, n, n);
    return (
      `The message says "${rule.phrase}", so ${subject} = ${n} should be ${shouldThrow ? 'rejected' : 'accepted'}, ` +
      `but the code checks \`${subject} ${guard.op} ${n}\` and ${shouldThrow ? 'accepts' : 'rejects'} it. Possible off-by-one.`
    );
  }
  return (
    `The message says "${rule.phrase}", which means it should throw when \`${subject} ${rule.rejected} ${n}\`, ` +
    `but the code throws when \`${subject} ${guard.op} ${n}\`. The comparison may be inverted.`
  );
}
