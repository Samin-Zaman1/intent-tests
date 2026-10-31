import * as ts from 'typescript';
import { FunctionAnalysis } from '../analysis/analyze';
import { Behavior, Condition, unwrap } from '../analysis/behaviors';
import { toComparison, toRelation } from '../analysis/mismatch';

/**
 * A plan is markdown:
 *
 *   # Allow 18-year-olds
 *
 *   ## `register` in src/signup.ts
 *   - When `user.age < 18` → throws "Age must be at least 18"
 *   - Not: when `user.age === 18` → throws
 *   - Always → returns `user.name`
 *
 * Backticks hold code, double quotes hold error messages or string contents, and the word after the arrow
 * (`throws`, `returns`, `runs`, `completes`) is the kind of outcome. Other lines are free-form notes.
 */
export interface Plan {
  title?: string;
  sections: PlanSection[];
}

export interface PlanSection {
  functionName: string;
  /** Relative to the repo root. */
  file?: string;
  /** 1-based line of the `##` header. */
  line: number;
  items: PlanItem[];
}

export interface PlanItem {
  text: string;
  line: number;
  /** `Not:` items describe a behavior that must not exist. */
  negated: boolean;
  /** Code fragments that must each match one of the behavior's conditions. */
  conditions: string[];
  kind?: 'throw' | 'return' | 'runs' | 'completes';
  /** Must appear in the thrown message, or in the outcome for other kinds. */
  message?: string;
  /** Code fragments in the outcome: the returned expression, or something run or thrown. */
  fragments: string[];
}

const HEADER = /^##\s+`([^`]+)`(?:\s+in\s+`?([^`\s]+)`?)?\s*$/;
const ARROW = /\s*(?:→|->)\s*/;
const KINDS: Record<string, PlanItem['kind']> = { throws: 'throw', returns: 'return', runs: 'runs', completes: 'completes' };

export function parsePlan(text: string): Plan {
  const plan: Plan = { sections: [] };
  let section: PlanSection | undefined;
  text.split(/\r?\n/).forEach((raw, i) => {
    const title = /^#\s+(.+)$/.exec(raw);
    if (title && !plan.title && !section) plan.title = title[1].trim();
    const header = HEADER.exec(raw);
    if (header) {
      section = { functionName: header[1], file: header[2], line: i + 1, items: [] };
      plan.sections.push(section);
      return;
    }
    const bullet = /^\s*[-*]\s+(.*)$/.exec(raw);
    if (bullet && section) {
      const item = parseItem(bullet[1], i + 1);
      if (item) section.items.push(item);
    }
  });
  return plan;
}

function backticks(text: string): string[] {
  return [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
}

export function parseItem(text: string, line = 0): PlanItem | undefined {
  let rest = text.trim();
  const negated = /^not:\s*/i.test(rest);
  rest = rest.replace(/^not:\s*/i, '');
  const parts = rest.split(ARROW);
  const [whenPart, outcomePart] = parts.length > 1 ? [parts[0], parts.slice(1).join(' → ')] : ['', parts[0]];
  const kindWord = /^(\w+)/.exec(outcomePart.trim())?.[1].toLowerCase();
  const kind = kindWord ? KINDS[kindWord] : undefined;
  const conditions = backticks(whenPart);
  const fragments = backticks(outcomePart);
  const message = /"([^"]*)"/.exec(outcomePart.replace(/`[^`]*`/g, ''))?.[1];
  if (!kind && !conditions.length && !fragments.length && message === undefined) return undefined;
  return { text: text.trim(), line, negated, conditions, kind, message, fragments };
}

/** Whitespace, quote style and a trailing semicolon do not matter when comparing code fragments. */
function norm(code: string): string {
  return code.replace(/\s+/g, '').replace(/"/g, "'").replace(/;$/, '');
}

/** `age` matches `user.age`: plans often name a field without the object it lives on. */
function sameOperand(a: string, b: string): boolean {
  const [x, y] = [norm(a), norm(b)];
  return x === y || x.endsWith(`.${y}`) || y.endsWith(`.${x}`);
}

const MIRROR: Record<string, string> = { '<': '>', '<=': '>=', '>': '<', '>=': '<=' };

function parseCondition(fragment: string): Condition | undefined {
  const sf = ts.createSourceFile('plan.ts', `(${fragment});`, ts.ScriptTarget.Latest, true);
  const statement = sf.statements[0];
  if (!statement || !ts.isExpressionStatement(statement)) return undefined;
  return { text: fragment, expr: unwrap(statement.expression), negated: false };
}

/**
 * Same text, the same comparison written another way (`18 > age` matches `user.age < 18`), or, for numeric
 * comparisons, a planned condition every value of which satisfies the code's: `age === 18` matches
 * `user.age <= 18`, because 18 takes that path.
 */
export function conditionMatches(fragment: string, condition: Condition): boolean {
  if (sameOperand(fragment, condition.text)) return true;
  const planned = parseCondition(fragment);
  if (!planned) return false;
  const a = toRelation(planned);
  const b = toRelation(condition);
  if (
    a &&
    b &&
    ((a.op === b.op && sameOperand(a.left, b.left) && sameOperand(a.right, b.right)) ||
      (MIRROR[a.op] === b.op && sameOperand(a.left, b.right) && sameOperand(a.right, b.left)))
  ) {
    return true;
  }
  const p = numericCondition(planned);
  const c = toComparison(condition);
  return !!p && !!c && sameOperand(p.subject, c.subject) && implies(p, c);
}

type NumericOp = '<' | '<=' | '>' | '>=' | '===';

/** `age === 18` or any `toComparison` form, with the subject on the left. */
function numericCondition(condition: Condition): { subject: string; op: NumericOp; value: number } | undefined {
  const comparison = toComparison(condition);
  if (comparison) return comparison;
  const e = condition.expr && unwrap(condition.expr);
  if (!e || !ts.isBinaryExpression(e)) return undefined;
  const kind = e.operatorToken.kind;
  if (kind !== ts.SyntaxKind.EqualsEqualsEqualsToken && kind !== ts.SyntaxKind.EqualsEqualsToken) return undefined;
  const [subject, literal] = ts.isNumericLiteral(unwrap(e.right)) ? [e.left, e.right] : [e.right, e.left];
  const value = unwrap(literal);
  return ts.isNumericLiteral(value) ? { subject: subject.getText(), op: '===', value: Number(value.text) } : undefined;
}

/** Whether every number satisfying `p` also satisfies `c`. */
function implies(p: { op: NumericOp; value: number }, c: { op: '<' | '<=' | '>' | '>='; value: number }): boolean {
  const holds = (x: number) => (c.op === '<' ? x < c.value : c.op === '<=' ? x <= c.value : c.op === '>' ? x > c.value : x >= c.value);
  if (p.op === '===') return holds(p.value);
  if (p.op[0] !== c.op[0]) return false;
  // Same direction: `x < 18` implies `x <= 18` and `x < 21`; `x <= 18` implies `x < 19` but not `x < 18`.
  const inclusive = p.op.length === 2;
  if (p.op[0] === '<') return c.op === '<=' ? c.value >= p.value : inclusive ? c.value > p.value : c.value >= p.value;
  return c.op === '>=' ? c.value <= p.value : inclusive ? c.value < p.value : c.value <= p.value;
}

export function itemMatches(item: PlanItem, b: Behavior): boolean {
  if (item.kind === 'throw' && b.kind !== 'throw') return false;
  if (item.kind === 'return' && b.kind !== 'return') return false;
  if (item.kind === 'completes' && b.kind !== 'completes') return false;
  if (!item.conditions.every((f) => b.conditions.some((c) => conditionMatches(f, c)))) return false;
  if (item.message !== undefined && !(b.throwMessage ?? b.outcome).includes(item.message)) return false;
  const [first, ...others] = item.fragments;
  if (first === undefined) return true;
  // `returns \`x\`` names the returned value exactly; other fragments only need to appear somewhere on the path.
  if (item.kind === 'return' && norm(b.outcome) !== norm(`returns ${first}`)) return false;
  const haystack = [b.outcome, ...b.steps].map(norm);
  return (item.kind === 'return' ? others : item.fragments).every((f) => haystack.some((h) => h.includes(norm(f))));
}

/** The behavior that satisfies most of the item, to explain what is there instead. */
export function closestBehavior(item: PlanItem, behaviors: Behavior[]): Behavior | undefined {
  let best: { b: Behavior; score: number } | undefined;
  for (const b of behaviors) {
    let score = item.conditions.filter((f) => b.conditions.some((c) => conditionMatches(f, c))).length;
    if (item.kind && itemMatches({ ...item, conditions: [], message: undefined, fragments: [] }, b)) score += 1;
    if (item.message !== undefined && (b.throwMessage ?? b.outcome).includes(item.message)) score += 1;
    if (score > 0 && (!best || score > best.score)) best = { b, score };
  }
  return best?.b;
}

/** A plan section describing what the function does now, as a starting point to edit. */
export function planSection(fn: FunctionAnalysis, file: string): string {
  const lines = [`## \`${fn.name}\` in ${file}`, ''];
  for (const b of fn.behaviors) lines.push(`- ${describePlanned(b)}`);
  return lines.join('\n') + '\n';
}

export function describePlanned(b: Behavior): string {
  const when = b.conditions.length ? `When ${b.conditions.map((c) => `\`${c.text}\``).join(' and ')}` : 'Always';
  const code = (prefix: string) => `\`${b.outcome.slice(prefix.length)}\``;
  const outcome =
    b.kind === 'throw'
      ? b.throwMessage !== undefined && !b.throwMessage.includes('"')
        ? `throws "${b.throwMessage}"`
        : `throws ${code('throws ')}`
      : b.kind === 'return'
        ? `returns ${code('returns ')}`
        : b.kind === 'branch'
          ? `runs ${code('runs ')}`
          : 'completes';
  return `${when} → ${outcome}`;
}
