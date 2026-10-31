import * as ts from 'typescript';

/** One condition on the path to an outcome, e.g. `age < 18`. */
export interface Condition {
  /** Readable form, already negated where needed. */
  text: string;
  /** Source expression; absent for synthetic conditions such as switch cases. */
  expr?: ts.Expression;
  negated: boolean;
}

export type OutcomeKind = 'return' | 'throw' | 'branch' | 'completes';

/** A distinct thing the function does under a specific set of conditions. Each one deserves a test. */
export interface Behavior {
  kind: OutcomeKind;
  conditions: Condition[];
  /**
   * Statements run on the way to the outcome, printed without comments or formatting. Two behaviors with the same
   * conditions and outcome text still differ if these differ, e.g. `const tolerance = 4 * EPSILON` before `return`.
   */
  steps: string[];
  outcome: string;
  /** Message of a thrown error, when it is a literal. */
  throwMessage?: string;
  /** 0-based line of the statement producing the outcome. */
  line: number;
}

export interface FunctionInfo {
  name: string;
  node: ts.FunctionLikeDeclaration;
  /** Node carrying the JSDoc: the variable statement for `const f = () => {}`, otherwise the function itself. */
  host: ts.Node;
  /** 0-based line of the declaration. */
  line: number;
  /** Offset of the name to look up references from (the class name for constructors). */
  namePos: number;
  params: { name: string; type?: string }[];
  returnType?: string;
  behaviors: Behavior[];
  /** Name of the enclosing function, for functions nested inside another one. */
  parent?: string;
}

/** A module-level value such as `const ulid = /^[0-7].../`. Functions that read it change behavior when it changes. */
export interface TopLevelValue {
  name: string;
  /** Printed without comments or formatting. */
  text: string;
  exported: boolean;
}

interface Path {
  conditions: Condition[];
  steps: string[];
}

interface Context {
  sf: ts.SourceFile;
  out: Behavior[];
}

const printer = ts.createPrinter({ removeComments: true });

/**
 * Removes type annotations, type arguments and `as`/`satisfies`/`!`, which do not change what the code does, and
 * empties the bodies of nested functions, which are analyzed as functions of their own.
 */
const normalize: ts.TransformerFactory<ts.Node> = (context) => {
  const visit = (node: ts.Node): ts.Node | undefined => {
    if (ts.isBlock(node) && node.parent && ts.isFunctionLike(node.parent)) return context.factory.createBlock([]);
    if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node)) {
      return visit(node.expression);
    }
    if (ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)) return undefined;
    // `extends Base` is an expression with type arguments, but it is also code.
    if ((ts.isTypeNode(node) && !ts.isExpressionWithTypeArguments(node)) || ts.isTypeParameterDeclaration(node)) return undefined;
    return ts.visitEachChild(node, visit, context);
  };
  return (node) => visit(node) ?? node;
};

/** Source text with comments, formatting, types and nested function bodies normalized away, for comparing code across versions. */
export function canonical(sf: ts.SourceFile, node: ts.Node): string {
  try {
    const result = ts.transform(node, [normalize]);
    try {
      return clean(printer.printNode(ts.EmitHint.Unspecified, result.transformed[0], sf)).replace(/;$/, '');
    } finally {
      result.dispose();
    }
  } catch {
    // A construct the type stripper cannot rebuild: compare the raw text rather than fail the whole file.
    return snippet(sf, node);
  }
}

export function parse(fileName: string, text: string): ts.SourceFile {
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, scriptKindFor(fileName));
}

function scriptKindFor(fileName: string): ts.ScriptKind {
  if (fileName.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (fileName.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (/\.[cm]?js$/.test(fileName)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

/**
 * Testable functions: declarations, methods, functions assigned to variables or class properties, default exports,
 * and (after each of those) the block-bodied functions nested inside it.
 */
export function findFunctions(sf: ts.SourceFile): FunctionInfo[] {
  const found: FunctionInfo[] = [];
  const push = (fn: FunctionInfo): void => {
    found.push(fn);
    nestedFunctions(sf, fn).forEach(push);
  };
  const visit = (node: ts.Node, cls?: ts.ClassLikeDeclaration): void => {
    const className = cls && (cls.name?.text ?? 'AnonymousClass');
    if (ts.isFunctionDeclaration(node) && node.body) {
      // `export default function () {}` has no name.
      push(describe(sf, node, node.name?.text ?? 'default', node, node.name ?? node));
      return;
    }
    if (ts.isExportAssignment(node) && (ts.isArrowFunction(node.expression) || ts.isFunctionExpression(node.expression))) {
      push(describe(sf, node.expression, 'default', node, node.expression));
      return;
    }
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      node.members.forEach((member) => visit(member, node));
      return;
    }
    if (ts.isConstructorDeclaration(node) && node.body) {
      push(describe(sf, node, `${className ?? 'AnonymousClass'}.constructor`, node, cls?.name ?? node));
      return;
    }
    if ((ts.isMethodDeclaration(node) || ts.isGetAccessor(node) || ts.isSetAccessor(node)) && node.body) {
      const member = node.name.getText(sf);
      push(describe(sf, node, className ? `${className}.${member}` : member, node, node.name));
      return;
    }
    if (
      (ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node)) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ) {
      const statement = node.parent.parent;
      const host = ts.isVariableDeclaration(node) && ts.isVariableStatement(statement) ? statement : node;
      const name = ts.isPropertyDeclaration(node) && className ? `${className}.${node.name.text}` : node.name.text;
      push(describe(sf, node.initializer, name, host, node.name));
      return;
    }
    // Functions inside other expressions: `export default supported && function httpAdapter() {}`, `app.get('/', (req) => {})`.
    if ((ts.isFunctionExpression(node) || ts.isArrowFunction(node)) && node.body) {
      const name = expressionFunctionName(sf, node);
      if (name) {
        push(describe(sf, node, name, node, ts.isFunctionExpression(node) && node.name ? node.name : node));
        return;
      }
    }
    ts.forEachChild(node, (child) => visit(child, cls));
  };
  visit(sf);
  return found;
}

/** Its own name, `default` inside an `export default` expression, or `<callee> callback` for an argument; else undefined. */
function expressionFunctionName(sf: ts.SourceFile, fn: ts.FunctionExpression | ts.ArrowFunction): string | undefined {
  if (ts.isFunctionExpression(fn) && fn.name) return fn.name.text;
  for (let node: ts.Node = fn.parent; node && !ts.isSourceFile(node); node = node.parent) {
    if (ts.isExportAssignment(node)) return 'default';
    if (ts.isCallExpression(node) && node.arguments.includes(fn as ts.Expression)) return `${clean(node.expression.getText(sf))} callback`;
    if (ts.isPropertyAssignment(node) && node.initializer === fn) return node.name.getText(sf);
    if (!ts.isParenthesizedExpression(node) && !ts.isBinaryExpression(node) && !ts.isConditionalExpression(node)) break;
  }
  return undefined;
}

/** Block-bodied functions directly inside `parent` (not inside those), each named `parent › child`. */
function nestedFunctions(sf: ts.SourceFile, parent: FunctionInfo): FunctionInfo[] {
  const nested: FunctionInfo[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionLike(node) && 'body' in node && node.body && ts.isBlock(node.body)) {
      const fn = node as ts.FunctionLikeDeclaration;
      const { name, nameNode } = nestedName(sf, fn);
      nested.push(describe(sf, fn, `${parent.name} › ${name}`, fn, nameNode, parent.name));
      return;
    }
    ts.forEachChild(node, visit);
  };
  if (parent.node.body) ts.forEachChild(parent.node.body, visit);
  return nested;
}

function nestedName(sf: ts.SourceFile, fn: ts.FunctionLikeDeclaration): { name: string; nameNode: ts.Node } {
  if (fn.name) return { name: fn.name.getText(sf), nameNode: fn.name };
  let parent = fn.parent;
  while (ts.isParenthesizedExpression(parent) || ts.isAwaitExpression(parent)) parent = parent.parent;
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return { name: parent.name.text, nameNode: parent.name };
  if (ts.isPropertyAssignment(parent)) return { name: parent.name.getText(sf), nameNode: parent.name };
  if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
    return { name: clean(parent.left.getText(sf)), nameNode: parent.left };
  }
  if (ts.isCallExpression(parent) || ts.isNewExpression(parent)) return { name: `${clean(parent.expression.getText(sf))} callback`, nameNode: fn };
  if (ts.isReturnStatement(parent)) return { name: 'returned function', nameNode: fn };
  return { name: 'anonymous function', nameNode: fn };
}

/** Module-level `const`/`let`/`var` values that are not functions. */
export function findTopLevelValues(sf: ts.SourceFile): TopLevelValue[] {
  const values: TopLevelValue[] = [];
  for (const statement of sf.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    const exported = !!statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    for (const decl of statement.declarationList.declarations) {
      const init = decl.initializer;
      if (!ts.isIdentifier(decl.name) || !init || ts.isArrowFunction(init) || ts.isFunctionExpression(init)) continue;
      values.push({ name: decl.name.text, text: canonical(sf, init), exported });
    }
  }
  return values;
}

function describe(
  sf: ts.SourceFile,
  fn: ts.FunctionLikeDeclaration,
  name: string,
  host: ts.Node,
  nameNode: ts.Node,
  parent?: string,
): FunctionInfo {
  return {
    name,
    parent,
    node: fn,
    host,
    line: lineOf(sf, host.getStart(sf)),
    namePos: nameNode.getStart(sf),
    params: fn.parameters.map((p) => ({ name: p.name.getText(sf), type: p.type?.getText(sf) })),
    returnType: fn.type?.getText(sf),
    behaviors: collectBehaviors(sf, fn),
  };
}

/** Walks the function body and records every path to a return, a throw, a branch that does work, or the end. */
export function collectBehaviors(sf: ts.SourceFile, fn: ts.FunctionLikeDeclaration): Behavior[] {
  const ctx: Context = { sf, out: [] };
  const body = fn.body;
  if (!body) return ctx.out;
  const start: Path = { conditions: [], steps: [] };
  if (!ts.isBlock(body)) {
    addReturn(ctx, body, start, body);
    return ctx.out;
  }
  const end = visitStatements(ctx, body.statements, start);
  if (end !== null) {
    ctx.out.push({ kind: 'completes', ...end, outcome: 'completes without returning a value', line: lineOf(sf, body.getEnd()) });
  }
  return ctx.out;
}

const when = (path: Path, condition: Condition): Path => ({ conditions: [...path.conditions, condition], steps: path.steps });
const then = (ctx: Context, path: Path, s: ts.Node): Path => ({ conditions: path.conditions, steps: [...path.steps, canonical(ctx.sf, s)] });

/** Returns the path that holds after the statements run, or null if every path exits the function. */
function visitStatements(ctx: Context, statements: readonly ts.Statement[], path: Path): Path | null {
  let current = path;
  for (const statement of statements) {
    const next = visitStatement(ctx, statement, current);
    if (next === null) return null;
    current = next;
  }
  return current;
}

function visitStatement(ctx: Context, s: ts.Statement, path: Path): Path | null {
  const { sf } = ctx;
  if (ts.isBlock(s)) return visitStatements(ctx, s.statements, path);
  if (ts.isLabeledStatement(s)) return visitStatement(ctx, s.statement, path);
  if (ts.isEmptyStatement(s) || ts.isTypeAliasDeclaration(s) || ts.isInterfaceDeclaration(s)) return path;

  if (ts.isReturnStatement(s)) {
    addReturn(ctx, s.expression, path, s);
    return null;
  }
  if (ts.isThrowStatement(s)) {
    addThrow(ctx, s, path);
    return null;
  }

  // Where branches rejoin, the whole statement becomes a step: what runs after it may depend on what ran inside it.
  if (ts.isIfStatement(s)) {
    const thenEnd = visitStatement(ctx, s.thenStatement, when(path, condition(sf, s.expression, false)));
    if (thenEnd !== null) addBranch(ctx, thenEnd, s.thenStatement);
    let elseEnd: Path | null = when(path, condition(sf, s.expression, true));
    if (s.elseStatement) {
      elseEnd = visitStatement(ctx, s.elseStatement, elseEnd);
      if (elseEnd !== null && !ts.isIfStatement(s.elseStatement)) addBranch(ctx, elseEnd, s.elseStatement);
    }
    if (thenEnd === null) return elseEnd;
    if (elseEnd === null) return thenEnd;
    return then(ctx, path, s);
  }

  if (ts.isSwitchStatement(s)) {
    const subject = clean(s.expression.getText(sf));
    let allExit = true;
    let hasDefault = false;
    let labels: string[] = [];
    for (const clause of s.caseBlock.clauses) {
      if (ts.isDefaultClause(clause)) hasDefault = true;
      labels.push(ts.isCaseClause(clause) ? `${subject} === ${clean(clause.expression.getText(sf))}` : `${subject} matches no case`);
      // Empty clauses fall through, so their labels join the next clause's condition.
      if (clause.statements.length === 0) continue;
      const end = visitStatements(ctx, clause.statements, when(path, { text: labels.join(' || '), negated: false }));
      labels = [];
      if (end !== null) {
        allExit = false;
        addBranch(ctx, end, clause.statements);
      }
    }
    return allExit && hasDefault ? null : then(ctx, path, s);
  }

  if (ts.isTryStatement(s)) {
    const tryEnd = visitStatements(ctx, s.tryBlock.statements, path);
    const catchEnd = s.catchClause
      ? visitStatements(ctx, s.catchClause.block.statements, when(path, { text: 'an error is thrown in the try block', negated: false }))
      : null;
    if (s.finallyBlock) visitStatements(ctx, s.finallyBlock.statements, path);
    return tryEnd === null && catchEnd === null ? null : then(ctx, path, s);
  }

  if (
    ts.isForStatement(s) ||
    ts.isForOfStatement(s) ||
    ts.isForInStatement(s) ||
    ts.isWhileStatement(s) ||
    ts.isDoStatement(s)
  ) {
    visitStatement(ctx, s.statement, when(path, { text: `inside loop: ${loopHeader(sf, s)}`, negated: false }));
    return then(ctx, path, s);
  }

  return then(ctx, path, s);
}

function addReturn(ctx: Context, expr: ts.Expression | undefined, path: Path, at: ts.Node): void {
  const e = expr && unwrap(expr);
  if (e && ts.isConditionalExpression(e)) {
    addReturn(ctx, e.whenTrue, when(path, condition(ctx.sf, e.condition, false)), at);
    addReturn(ctx, e.whenFalse, when(path, condition(ctx.sf, e.condition, true)), at);
    return;
  }
  ctx.out.push({
    kind: 'return',
    ...path,
    outcome: e ? `returns ${canonical(ctx.sf, e)}` : 'returns undefined',
    line: lineOf(ctx.sf, at.getStart(ctx.sf)),
  });
}

function addThrow(ctx: Context, s: ts.ThrowStatement, path: Path): void {
  const { sf } = ctx;
  const e = unwrap(s.expression);
  let outcome = `throws ${snippet(sf, e)}`;
  let throwMessage: string | undefined;
  if (ts.isNewExpression(e) || ts.isCallExpression(e)) {
    const arg = e.arguments?.[0];
    if (arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg))) throwMessage = arg.text;
    else if (arg && ts.isTemplateExpression(arg)) throwMessage = arg.getText(sf).slice(1, -1);
    outcome = `throws ${e.expression.getText(sf)}` + (throwMessage !== undefined ? `: "${throwMessage}"` : '');
  }
  ctx.out.push({ kind: 'throw', ...path, outcome, throwMessage, line: lineOf(sf, s.getStart(sf)) });
}

/** Records a branch that does work without exiting, unless it only nests further control flow. */
function addBranch(ctx: Context, path: Path, body: ts.Statement | readonly ts.Statement[]): void {
  const statements = Array.isArray(body) ? body : ts.isBlock(body as ts.Statement) ? (body as ts.Block).statements : [body as ts.Statement];
  const work = statements.find((s) => ts.isExpressionStatement(s) || ts.isVariableStatement(s));
  if (!work) return;
  ctx.out.push({ kind: 'branch', ...path, outcome: `runs ${canonical(ctx.sf, work)}`, line: lineOf(ctx.sf, work.getStart(ctx.sf)) });
}

function loopHeader(sf: ts.SourceFile, s: ts.IterationStatement): string {
  if (ts.isForOfStatement(s)) return `${clean(s.initializer.getText(sf))} of ${clean(s.expression.getText(sf))}`;
  if (ts.isForInStatement(s)) return `${clean(s.initializer.getText(sf))} in ${clean(s.expression.getText(sf))}`;
  if (ts.isForStatement(s)) return s.condition ? clean(s.condition.getText(sf)) : 'for';
  if (ts.isWhileStatement(s) || ts.isDoStatement(s)) return clean(s.expression.getText(sf));
  return 'loop';
}

const NEGATED_OPERATOR: Partial<Record<ts.SyntaxKind, string>> = {
  [ts.SyntaxKind.LessThanToken]: '>=',
  [ts.SyntaxKind.LessThanEqualsToken]: '>',
  [ts.SyntaxKind.GreaterThanToken]: '<=',
  [ts.SyntaxKind.GreaterThanEqualsToken]: '<',
  [ts.SyntaxKind.EqualsEqualsEqualsToken]: '!==',
  [ts.SyntaxKind.ExclamationEqualsEqualsToken]: '===',
  [ts.SyntaxKind.EqualsEqualsToken]: '!=',
  [ts.SyntaxKind.ExclamationEqualsToken]: '==',
};

function condition(sf: ts.SourceFile, expr: ts.Expression, negated: boolean): Condition {
  return { text: negated ? negateText(sf, expr) : clean(expr.getText(sf)), expr, negated };
}

function negateText(sf: ts.SourceFile, expr: ts.Expression): string {
  const e = unwrap(expr);
  if (ts.isPrefixUnaryExpression(e) && e.operator === ts.SyntaxKind.ExclamationToken) return clean(e.operand.getText(sf));
  if (ts.isBinaryExpression(e)) {
    const flipped = NEGATED_OPERATOR[e.operatorToken.kind];
    if (flipped) return `${clean(e.left.getText(sf))} ${flipped} ${clean(e.right.getText(sf))}`;
  }
  if (ts.isIdentifier(e) || ts.isPropertyAccessExpression(e) || ts.isCallExpression(e)) return `!${clean(e.getText(sf))}`;
  return `!(${clean(e.getText(sf))})`;
}

export function unwrap(expr: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(expr)) expr = expr.expression;
  return expr;
}

export function lineOf(sf: ts.SourceFile, pos: number): number {
  return sf.getLineAndCharacterOfPosition(pos).line;
}

function clean(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Full source text on one line. Never shortened here, so behaviors that differ late in a long expression still compare unequal. */
function snippet(sf: ts.SourceFile, node: ts.Node): string {
  return clean(node.getText(sf)).replace(/;$/, '');
}

/** Shortens text for display. */
export function truncate(text: string, max = 80): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
