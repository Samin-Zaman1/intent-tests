import * as ts from 'typescript';
import { isTestFile } from './tests';

/** What the caller does with the returned value. */
export type ResultUse = 'ignored' | 'condition' | 'null-checked' | 'returned' | 'assigned' | 'argument' | 'other';

/** One place the function is called. Callers show which behaviors matter in practice; tests show what was already intended. */
export interface CallSite {
  fileName: string;
  /** 0-based. */
  line: number;
  isTest: boolean;
  awaited: boolean;
  /** Inside a try block with a catch, or chained with `.catch()`. */
  handlesErrors: boolean;
  resultUse: ResultUse;
  /** Source text of each argument when it is a literal value, otherwise undefined. */
  args: (string | undefined)[];
  /** For calls inside tests: "describe › it" titles. */
  testName?: string;
  /** For calls inside tests: the enclosing `expect(...)` statement. */
  assertion?: string;
  /** The named function making the call (anonymous callbacks resolve to the function owning them). */
  enclosing?: { name: string; pos: number };
}

const TEST_FUNCTIONS = new Set(['describe', 'it', 'test', 'suite']);

export function findCallSites(service: ts.LanguageService, fileName: string, position: number): CallSite[] {
  const program = service.getProgram();
  if (!program) return [];
  const sites: CallSite[] = [];
  for (const symbol of service.findReferences(fileName, position) ?? []) {
    for (const ref of symbol.references) {
      if (ref.isDefinition) continue;
      const sf = program.getSourceFile(ref.fileName);
      const node = sf && nodeAt(sf, ref.textSpan.start);
      const call = node && callOf(node);
      if (sf && call) sites.push(describeCall(sf, call));
    }
  }
  return sites;
}

function nodeAt(sf: ts.SourceFile, pos: number): ts.Node | undefined {
  let found: ts.Node | undefined;
  const visit = (node: ts.Node): void => {
    if (pos >= node.getStart(sf) && pos < node.getEnd()) {
      found = node;
      ts.forEachChild(node, visit);
    }
  };
  ts.forEachChild(sf, visit);
  return found;
}

/** The call or `new` expression invoking the referenced name, if the reference is one. */
function callOf(name: ts.Node): ts.CallExpression | ts.NewExpression | undefined {
  let callee = name;
  if (ts.isPropertyAccessExpression(callee.parent) && callee.parent.name === callee) callee = callee.parent;
  const parent = callee.parent;
  if ((ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.expression === callee) return parent;
  return undefined;
}

function describeCall(sf: ts.SourceFile, call: ts.CallExpression | ts.NewExpression): CallSite {
  let outer: ts.Node = call;
  let awaited = false;
  for (;;) {
    const parent = outer.parent;
    if (ts.isAwaitExpression(parent)) awaited = true;
    else if (!ts.isParenthesizedExpression(parent) && !ts.isNonNullExpression(parent) && !ts.isAsExpression(parent)) break;
    outer = parent;
  }
  const isTest = isTestFile(sf.fileName);
  return {
    fileName: sf.fileName,
    line: sf.getLineAndCharacterOfPosition(call.getStart(sf)).line,
    isTest,
    awaited,
    handlesErrors: insideTry(call) || chainedCatch(call),
    resultUse: classifyUse(outer),
    args: (call.arguments ?? []).map((arg) => (isLiteral(arg) ? arg.getText(sf).replace(/\s+/g, ' ') : undefined)),
    enclosing: enclosingFunction(sf, call),
    ...(isTest ? testContext(sf, call) : {}),
  };
}

function enclosingFunction(sf: ts.SourceFile, node: ts.Node): CallSite['enclosing'] {
  for (let current = node.parent; current; current = current.parent) {
    if (!ts.isFunctionLike(current)) continue;
    const name = nameOf(current);
    if (name) return { name: name.getText(sf), pos: name.getStart(sf) };
  }
  return undefined;
}

function nameOf(fn: ts.SignatureDeclaration): ts.Node | undefined {
  if ((ts.isFunctionDeclaration(fn) || ts.isMethodDeclaration(fn) || ts.isGetAccessor(fn) || ts.isSetAccessor(fn)) && fn.name) {
    return fn.name;
  }
  if (ts.isConstructorDeclaration(fn)) return fn.parent.name;
  if (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) {
    const parent = fn.parent;
    if ((ts.isVariableDeclaration(parent) || ts.isPropertyDeclaration(parent) || ts.isPropertyAssignment(parent)) && ts.isIdentifier(parent.name)) {
      return parent.name;
    }
  }
  return undefined;
}

function classifyUse(outer: ts.Node): ResultUse {
  const parent = outer.parent;
  if (ts.isExpressionStatement(parent)) return 'ignored';
  if (ts.isReturnStatement(parent) || (ts.isArrowFunction(parent) && parent.body === outer)) return 'returned';
  if (ts.isVariableDeclaration(parent) && parent.initializer === outer) {
    return ts.isIdentifier(parent.name) && variableIsChecked(parent.name) ? 'null-checked' : 'assigned';
  }
  if ((ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.arguments?.includes(outer as ts.Expression)) {
    return 'argument';
  }
  return checkOf(outer) ?? 'other';
}

/** How a value is tested where it is used, if it is tested at all. */
function checkOf(node: ts.Node): 'condition' | 'null-checked' | undefined {
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.expression === node && parent.questionDotToken) return 'null-checked';
  if (ts.isElementAccessExpression(parent) && parent.expression === node && parent.questionDotToken) return 'null-checked';
  if (ts.isBinaryExpression(parent)) {
    const op = parent.operatorToken.kind;
    if (op === ts.SyntaxKind.QuestionQuestionToken && parent.left === node) return 'null-checked';
    const other = parent.left === node ? parent.right : parent.left;
    const isEquality =
      op === ts.SyntaxKind.EqualsEqualsEqualsToken ||
      op === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
      op === ts.SyntaxKind.EqualsEqualsToken ||
      op === ts.SyntaxKind.ExclamationEqualsToken;
    if (isEquality && (other.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(other) && other.text === 'undefined'))) {
      return 'null-checked';
    }
    if (op === ts.SyntaxKind.AmpersandAmpersandToken || op === ts.SyntaxKind.BarBarToken) return 'condition';
  }
  if (ts.isPrefixUnaryExpression(parent) && parent.operator === ts.SyntaxKind.ExclamationToken) return 'condition';
  if ((ts.isIfStatement(parent) || ts.isWhileStatement(parent)) && parent.expression === node) return 'condition';
  if (ts.isConditionalExpression(parent) && parent.condition === node) return 'condition';
  return undefined;
}

/** Whether a variable holding the result is later tested for null or truthiness in the same scope. */
function variableIsChecked(name: ts.Identifier): boolean {
  let scope: ts.Node = name;
  while (scope.parent && !ts.isBlock(scope) && !ts.isSourceFile(scope)) scope = scope.parent;
  let checked = false;
  const visit = (node: ts.Node): void => {
    if (checked) return;
    if (ts.isIdentifier(node) && node !== name && node.text === name.text && checkOf(node)) checked = true;
    else ts.forEachChild(node, visit);
  };
  ts.forEachChild(scope, visit);
  return checked;
}

function insideTry(node: ts.Node): boolean {
  for (let current = node; current.parent && !ts.isFunctionLike(current); current = current.parent) {
    const parent = current.parent;
    if (ts.isTryStatement(parent) && parent.tryBlock === current && parent.catchClause) return true;
  }
  return false;
}

function chainedCatch(call: ts.Expression): boolean {
  let current: ts.Node = call;
  while (ts.isPropertyAccessExpression(current.parent) && ts.isCallExpression(current.parent.parent)) {
    if (current.parent.name.text === 'catch') return true;
    current = current.parent.parent;
  }
  return false;
}

function isLiteral(node: ts.Expression): boolean {
  switch (node.kind) {
    case ts.SyntaxKind.NumericLiteral:
    case ts.SyntaxKind.StringLiteral:
    case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
    case ts.SyntaxKind.TrueKeyword:
    case ts.SyntaxKind.FalseKeyword:
    case ts.SyntaxKind.NullKeyword:
      return true;
  }
  if (ts.isIdentifier(node)) return node.text === 'undefined';
  if (ts.isPrefixUnaryExpression(node)) return node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand);
  if (ts.isArrayLiteralExpression(node)) return node.elements.every(isLiteral);
  if (ts.isObjectLiteralExpression(node)) {
    return node.properties.every((p) => ts.isPropertyAssignment(p) && isLiteral(p.initializer));
  }
  return false;
}

function testContext(sf: ts.SourceFile, call: ts.Node): Pick<CallSite, 'testName' | 'assertion'> {
  const titles: string[] = [];
  let inTest = false;
  let assertion: string | undefined;
  for (let node: ts.Node = call; node.parent; node = node.parent) {
    if (!assertion && ts.isExpressionStatement(node) && /^expect\s*\(/.test(node.getText(sf))) {
      assertion = node.getText(sf).replace(/\s+/g, ' ').replace(/;$/, '');
    }
    if (!ts.isCallExpression(node)) continue;
    const fn = rootIdentifier(node.expression);
    const [title] = node.arguments;
    if (!fn || !TEST_FUNCTIONS.has(fn) || !title || !(ts.isStringLiteral(title) || ts.isNoSubstitutionTemplateLiteral(title))) continue;
    titles.unshift(title.text);
    if (fn !== 'describe' && fn !== 'suite') inTest = true;
  }
  return inTest ? { testName: titles.join(' › '), assertion } : { assertion };
}

/** `it` for `it(...)`, `it.only(...)` and `it.each(table)(...)`. */
function rootIdentifier(expr: ts.Expression): string | undefined {
  while (ts.isPropertyAccessExpression(expr) || ts.isCallExpression(expr)) expr = expr.expression;
  return ts.isIdentifier(expr) ? expr.text : undefined;
}
