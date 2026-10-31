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
}

interface Context {
  sf: ts.SourceFile;
  out: Behavior[];
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

/** Top-level testable functions: declarations, methods, and functions assigned to variables or class properties. */
export function findFunctions(sf: ts.SourceFile): FunctionInfo[] {
  const found: FunctionInfo[] = [];
  const visit = (node: ts.Node, cls?: ts.ClassLikeDeclaration): void => {
    const className = cls && (cls.name?.text ?? 'AnonymousClass');
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      found.push(describe(sf, node, node.name.text, node, node.name));
      return;
    }
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      node.members.forEach((member) => visit(member, node));
      return;
    }
    if (ts.isConstructorDeclaration(node) && node.body) {
      found.push(describe(sf, node, `${className ?? 'AnonymousClass'}.constructor`, node, cls?.name ?? node));
      return;
    }
    if ((ts.isMethodDeclaration(node) || ts.isGetAccessor(node) || ts.isSetAccessor(node)) && node.body) {
      const member = node.name.getText(sf);
      found.push(describe(sf, node, className ? `${className}.${member}` : member, node, node.name));
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
      found.push(describe(sf, node.initializer, name, host, node.name));
      return;
    }
    ts.forEachChild(node, (child) => visit(child, cls));
  };
  visit(sf);
  return found;
}

function describe(
  sf: ts.SourceFile,
  fn: ts.FunctionLikeDeclaration,
  name: string,
  host: ts.Node,
  nameNode: ts.Node,
): FunctionInfo {
  return {
    name,
    node: fn,
    host,
    line: lineOf(sf, host.getStart(sf)),
    namePos: nameNode.getStart(sf),
    params: fn.parameters.map((p) => ({ name: p.name.getText(sf), type: p.type?.getText(sf) })),
    returnType: fn.type?.getText(sf),
    behaviors: collectBehaviors(sf, fn),
  };
}

/** Walks the function body and records every path to a return, a throw, or a branch that does work. */
export function collectBehaviors(sf: ts.SourceFile, fn: ts.FunctionLikeDeclaration): Behavior[] {
  const ctx: Context = { sf, out: [] };
  const body = fn.body;
  if (!body) return ctx.out;
  if (!ts.isBlock(body)) {
    addReturn(ctx, body, [], body);
    return ctx.out;
  }
  const end = visitStatements(ctx, body.statements, []);
  if (end !== null && (ctx.out.length === 0 || end.length > 0)) {
    ctx.out.push({ kind: 'completes', conditions: end, outcome: 'completes without returning a value', line: lineOf(sf, body.getEnd()) });
  }
  return ctx.out;
}

/** Returns the conditions that hold after the statements run, or null if every path exits the function. */
function visitStatements(ctx: Context, statements: readonly ts.Statement[], path: Condition[]): Condition[] | null {
  let current = path;
  for (const statement of statements) {
    const next = visitStatement(ctx, statement, current);
    if (next === null) return null;
    current = next;
  }
  return current;
}

function visitStatement(ctx: Context, s: ts.Statement, path: Condition[]): Condition[] | null {
  const { sf } = ctx;
  if (ts.isBlock(s)) return visitStatements(ctx, s.statements, path);
  if (ts.isLabeledStatement(s)) return visitStatement(ctx, s.statement, path);

  if (ts.isReturnStatement(s)) {
    addReturn(ctx, s.expression, path, s);
    return null;
  }
  if (ts.isThrowStatement(s)) {
    addThrow(ctx, s, path);
    return null;
  }

  if (ts.isIfStatement(s)) {
    const thenEnd = visitStatement(ctx, s.thenStatement, [...path, condition(sf, s.expression, false)]);
    if (thenEnd !== null) addBranch(ctx, thenEnd, s.thenStatement);
    let elseEnd: Condition[] | null = [...path, condition(sf, s.expression, true)];
    if (s.elseStatement) {
      elseEnd = visitStatement(ctx, s.elseStatement, elseEnd);
      if (elseEnd !== null && !ts.isIfStatement(s.elseStatement)) addBranch(ctx, elseEnd, s.elseStatement);
    }
    if (thenEnd === null) return elseEnd;
    if (elseEnd === null) return thenEnd;
    return path;
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
      const end = visitStatements(ctx, clause.statements, [...path, { text: labels.join(' || '), negated: false }]);
      labels = [];
      if (end !== null) {
        allExit = false;
        addBranch(ctx, end, clause.statements);
      }
    }
    return allExit && hasDefault ? null : path;
  }

  if (ts.isTryStatement(s)) {
    const tryEnd = visitStatements(ctx, s.tryBlock.statements, path);
    const catchEnd = s.catchClause
      ? visitStatements(ctx, s.catchClause.block.statements, [...path, { text: 'an error is thrown in the try block', negated: false }])
      : null;
    if (s.finallyBlock) visitStatements(ctx, s.finallyBlock.statements, path);
    return tryEnd === null && catchEnd === null ? null : path;
  }

  if (
    ts.isForStatement(s) ||
    ts.isForOfStatement(s) ||
    ts.isForInStatement(s) ||
    ts.isWhileStatement(s) ||
    ts.isDoStatement(s)
  ) {
    visitStatement(ctx, s.statement, [...path, { text: `inside loop: ${loopHeader(sf, s)}`, negated: false }]);
    return path;
  }

  return path;
}

function addReturn(ctx: Context, expr: ts.Expression | undefined, path: Condition[], at: ts.Node): void {
  const e = expr && unwrap(expr);
  if (e && ts.isConditionalExpression(e)) {
    addReturn(ctx, e.whenTrue, [...path, condition(ctx.sf, e.condition, false)], at);
    addReturn(ctx, e.whenFalse, [...path, condition(ctx.sf, e.condition, true)], at);
    return;
  }
  ctx.out.push({
    kind: 'return',
    conditions: path,
    outcome: e ? `returns ${snippet(ctx.sf, e)}` : 'returns undefined',
    line: lineOf(ctx.sf, at.getStart(ctx.sf)),
  });
}

function addThrow(ctx: Context, s: ts.ThrowStatement, path: Condition[]): void {
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
  ctx.out.push({ kind: 'throw', conditions: path, outcome, throwMessage, line: lineOf(sf, s.getStart(sf)) });
}

/** Records a branch that does work without exiting, unless it only nests further control flow. */
function addBranch(ctx: Context, path: Condition[], body: ts.Statement | readonly ts.Statement[]): void {
  const statements = Array.isArray(body) ? body : ts.isBlock(body as ts.Statement) ? (body as ts.Block).statements : [body as ts.Statement];
  const work = statements.find((s) => ts.isExpressionStatement(s) || ts.isVariableStatement(s));
  if (!work) return;
  ctx.out.push({ kind: 'branch', conditions: path, outcome: `runs ${snippet(ctx.sf, work)}`, line: lineOf(ctx.sf, work.getStart(ctx.sf)) });
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
