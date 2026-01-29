import type { Token, TokenType } from './lexer.js';
import type { Diagnostic, Loc } from './types.js';
import type * as AST from './ast.js';

type ParseResult =
  | { type: 'ok'; file: AST.AlliumFile }
  | { type: 'error'; diagnostic: Diagnostic };

class Parser {
  private pos = 0;
  private filename: string;

  constructor(private tokens: Token[], filename: string) {
    this.filename = filename;
  }

  private peek(offset = 0): Token {
    return this.tokens[this.pos + offset] ?? this.tokens[this.tokens.length - 1];
  }

  private at(type: TokenType): boolean {
    return this.peek().type === type;
  }

  private atAny(...types: TokenType[]): boolean {
    return types.includes(this.peek().type);
  }

  private advance(): Token {
    return this.tokens[this.pos++];
  }

  private expect(type: TokenType): Token {
    if (!this.at(type)) {
      throw this.error(`expected '${type}', got '${this.peek().type}'`);
    }
    return this.advance();
  }

  private error(message: string): Error {
    const tok = this.peek();
    const err = new Error(message);
    (err as any).diagnostic = {
      file: this.filename,
      line: tok.loc.line,
      col: tok.loc.col,
      message,
    };
    return err;
  }

  parse(): ParseResult {
    try {
      const file = this.parseFile();
      return { type: 'ok', file };
    } catch (err) {
      if (err instanceof Error && (err as any).diagnostic) {
        return { type: 'error', diagnostic: (err as any).diagnostic };
      }
      throw err;
    }
  }

  private parseFile(): AST.AlliumFile {
    const file: AST.AlliumFile = {
      externals: [],
      values: [],
      entities: [],
      defaults: [],
      rules: [],
      deferred: [],
      openQuestions: [],
    };

    while (!this.at('eof')) {
      if (this.at('external')) {
        file.externals.push(this.parseExternalEntity());
      } else if (this.at('value')) {
        file.values.push(this.parseValueType());
      } else if (this.at('entity')) {
        file.entities.push(this.parseEntity());
      } else if (this.at('default')) {
        file.defaults.push(this.parseDefault());
      } else if (this.at('rule')) {
        file.rules.push(this.parseRule());
      } else if (this.at('deferred')) {
        file.deferred.push(this.parseDeferred());
      } else if (this.at('open')) {
        file.openQuestions.push(this.parseOpenQuestion());
      } else {
        throw this.error(`unexpected token '${this.peek().type}'`);
      }
    }

    return file;
  }

  private parseExternalEntity(): AST.ExternalEntity {
    const loc = this.peek().loc;
    this.expect('external');
    this.expect('entity');
    const name = this.expect('ident').value;
    this.expect('{');
    const fields = this.parseFields();
    this.expect('}');
    return { kind: 'external', name, fields, loc };
  }

  private parseValueType(): AST.ValueType {
    const loc = this.peek().loc;
    this.expect('value');
    const name = this.expect('ident').value;
    this.expect('{');
    const fields = this.parseFields();
    this.expect('}');
    return { kind: 'value', name, fields, loc };
  }

  private parseEntity(): AST.Entity {
    const loc = this.peek().loc;
    this.expect('entity');
    const name = this.expect('ident').value;
    this.expect('{');

    const fields: AST.Field[] = [];
    const relationships: AST.Relationship[] = [];
    const projections: AST.Projection[] = [];
    const derived: AST.Derived[] = [];

    while (!this.at('}') && !this.at('eof')) {
      const memberLoc = this.peek().loc;
      const memberName = this.expect('ident').value;
      this.expect(':');

      // Peek ahead to determine what kind of member this is
      if (this.at('ident') && this.peek(1).type === 'for') {
        // Relationship: sessions: Session for this user
        const target = this.expect('ident').value;
        this.expect('for');
        this.expect('this');
        const condition = this.expect('ident').value;
        relationships.push({ name: memberName, target, condition, loc: memberLoc });
      } else if (this.at('ident') && this.peek(1).type === 'with') {
        // Projection: active_sessions: sessions with status = active
        const source = this.expect('ident').value;
        this.expect('with');
        const filter = this.parseExpr();
        projections.push({ name: memberName, source, filter, loc: memberLoc });
      } else {
        // Could be a field or derived value
        // If the next thing is an expression that doesn't look like a type, it's derived
        const typeOrExpr = this.parseTypeOrExpr();
        if (typeOrExpr.kind === 'type') {
          fields.push({ name: memberName, type: typeOrExpr.type, loc: memberLoc });
        } else {
          derived.push({ name: memberName, expr: typeOrExpr.expr, loc: memberLoc });
        }
      }
    }

    this.expect('}');
    return { kind: 'entity', name, fields, relationships, projections, derived, loc };
  }

  private parseTypeOrExpr(): { kind: 'type'; type: AST.TypeExpr } | { kind: 'expr'; expr: AST.Expr } {
    // Heuristic: if it starts with an ident followed by certain patterns, it's a type
    // Otherwise treat as expression
    const start = this.pos;

    if (this.at('ident')) {
      const name = this.peek().value;

      // Check for Set<T> or List<T>
      if ((name === 'Set' || name === 'List') && this.peek(1).type === '<') {
        this.advance(); // consume Set/List
        this.expect('<');
        const inner = this.parseType();
        this.expect('>');
        return { kind: 'type', type: { kind: name === 'Set' ? 'set' : 'list', inner } };
      }

      // Check for optional type: T?
      if (this.peek(1).type === '?') {
        this.advance();
        this.advance();
        return { kind: 'type', type: { kind: 'optional', inner: { kind: 'primitive', name } } };
      }

      // Check for simple type (ident not followed by operator)
      const nextType = this.peek(1).type;
      if (nextType === '}' || nextType === 'eof' || nextType === 'ident') {
        const tok = this.advance();
        // Check if it's an enum: pending | active | ...
        if (this.at('|')) {
          const values = [tok.value];
          while (this.at('|')) {
            this.advance();
            values.push(this.expect('ident').value);
          }
          return { kind: 'type', type: { kind: 'enum', values } };
        }
        return { kind: 'type', type: this.identToType(tok.value) };
      }

      // Check for enum type
      if (this.peek(1).type === '|') {
        const values: string[] = [];
        values.push(this.advance().value);
        while (this.at('|')) {
          this.advance();
          values.push(this.expect('ident').value);
        }
        return { kind: 'type', type: { kind: 'enum', values } };
      }
    }

    // Otherwise parse as expression
    this.pos = start;
    const expr = this.parseExpr();
    return { kind: 'expr', expr };
  }

  private identToType(name: string): AST.TypeExpr {
    const primitives = ['String', 'Integer', 'Decimal', 'Boolean', 'Timestamp', 'Duration', 'Email', 'URL'];
    if (primitives.includes(name)) {
      return { kind: 'primitive', name };
    }
    return { kind: 'entity-ref', name };
  }

  private parseType(): AST.TypeExpr {
    if (this.at('ident')) {
      const name = this.advance().value;

      if (name === 'Set' || name === 'List') {
        this.expect('<');
        const inner = this.parseType();
        this.expect('>');
        return { kind: name === 'Set' ? 'set' : 'list', inner };
      }

      // Check for enum
      if (this.at('|')) {
        const values = [name];
        while (this.at('|')) {
          this.advance();
          values.push(this.expect('ident').value);
        }
        return { kind: 'enum', values };
      }

      // Check for optional
      if (this.at('?')) {
        this.advance();
        return { kind: 'optional', inner: this.identToType(name) };
      }

      return this.identToType(name);
    }

    throw this.error('expected type');
  }

  private parseFields(): AST.Field[] {
    const fields: AST.Field[] = [];
    while (!this.at('}') && !this.at('eof')) {
      const loc = this.peek().loc;
      const name = this.expect('ident').value;
      this.expect(':');
      const type = this.parseType();
      fields.push({ name, type, loc });
    }
    return fields;
  }

  private parseDefault(): AST.Default {
    const loc = this.peek().loc;
    this.expect('default');
    const name = this.expect('ident').value;
    this.expect('=');
    const value = this.parseExpr();
    return { name, value, loc };
  }

  private parseRule(): AST.Rule {
    const loc = this.peek().loc;
    this.expect('rule');
    const name = this.expect('ident').value;
    this.expect('{');

    let trigger: AST.Trigger | null = null;
    const lets: AST.LetBinding[] = [];
    const requires: AST.Expr[] = [];
    const ensures: AST.Expr[] = [];

    while (!this.at('}') && !this.at('eof')) {
      if (this.at('when')) {
        this.advance();
        this.expect(':');
        trigger = this.parseTrigger();
      } else if (this.at('let')) {
        lets.push(this.parseLetBinding());
      } else if (this.at('requires')) {
        this.advance();
        this.expect(':');
        requires.push(this.parseExpr());
      } else if (this.at('ensures')) {
        this.advance();
        this.expect(':');
        ensures.push(this.parseExpr());
      } else {
        throw this.error(`unexpected token in rule: '${this.peek().type}'`);
      }
    }

    this.expect('}');

    if (!trigger) {
      throw this.error(`rule '${name}' has no trigger`);
    }

    return { name, trigger, lets, requires, ensures, loc };
  }

  private parseTrigger(): AST.Trigger {
    const loc = this.peek().loc;

    // Check for binding: "interview: Interview.status becomes scheduled"
    if (this.at('ident') && this.peek(1).type === ':') {
      const binding = this.advance().value;
      this.advance(); // consume ':'
      const entity = this.expect('ident').value;

      if (this.at('.')) {
        this.advance();
        if (this.at('created')) {
          this.advance();
          return { kind: 'created', binding, entity, loc };
        }
        const field = this.expect('ident').value;
        this.expect('becomes');
        const value = this.parseExpr();
        return { kind: 'state-change', binding, entity, field, value, loc };
      }

      // Entity creation: "batch: DigestBatch.created" - but dot already consumed
      throw this.error('expected "." after entity name in trigger');
    }

    // External stimulus or chained: "UserLogsIn(email, password)"
    if (this.at('ident') && this.peek(1).type === '(') {
      const name = this.advance().value;
      this.expect('(');
      const params: AST.Param[] = [];

      while (!this.at(')') && !this.at('eof')) {
        const paramLoc = this.peek().loc;
        const paramName = this.expect('ident').value;
        const optional = this.at('?');
        if (optional) this.advance();
        params.push({ name: paramName, optional, loc: paramLoc });

        if (!this.at(')')) {
          this.expect(',');
        }
      }

      this.expect(')');
      return { kind: 'stimulus', name, params, loc };
    }

    // Temporal or derived: expression
    const expr = this.parseExpr();

    // Heuristic: if it's a comparison with 'now', it's temporal
    if (expr.kind === 'binary' && (expr.op === '<=' || expr.op === '<' || expr.op === '>=' || expr.op === '>')) {
      const hasNow = this.exprContainsNow(expr);
      if (hasNow) {
        return { kind: 'temporal', expr, loc };
      }
    }

    return { kind: 'derived', expr, loc };
  }

  private exprContainsNow(expr: AST.Expr): boolean {
    if (expr.kind === 'ident' && expr.name === 'now') return true;
    if (expr.kind === 'binary') {
      return this.exprContainsNow(expr.left) || this.exprContainsNow(expr.right);
    }
    if (expr.kind === 'field-access') {
      return this.exprContainsNow(expr.object);
    }
    return false;
  }

  private parseLetBinding(): AST.LetBinding {
    const loc = this.peek().loc;
    this.expect('let');
    const name = this.expect('ident').value;
    this.expect('=');
    const expr = this.parseExpr();
    return { name, expr, loc };
  }

  private parseExpr(): AST.Expr {
    return this.parseOr();
  }

  private parseOr(): AST.Expr {
    let left = this.parseAnd();
    while (this.at('or')) {
      const loc = this.peek().loc;
      this.advance();
      const right = this.parseAnd();
      left = { kind: 'binary', op: 'or', left, right, loc };
    }
    return left;
  }

  private parseAnd(): AST.Expr {
    let left = this.parseComparison();
    while (this.at('and')) {
      const loc = this.peek().loc;
      this.advance();
      const right = this.parseComparison();
      left = { kind: 'binary', op: 'and', left, right, loc };
    }
    return left;
  }

  private parseComparison(): AST.Expr {
    let left = this.parseAdditive();
    while (this.atAny('=', '!=', '<', '<=', '>', '>=', 'in', 'with')) {
      const loc = this.peek().loc;
      const op = this.advance().type as AST.BinaryOp;
      const right = this.parseAdditive();
      left = { kind: 'binary', op, left, right, loc };
    }
    return left;
  }

  private parseAdditive(): AST.Expr {
    let left = this.parseMultiplicative();
    while (this.atAny('+', '-')) {
      const loc = this.peek().loc;
      const op = this.advance().type as AST.BinaryOp;
      const right = this.parseMultiplicative();
      left = { kind: 'binary', op, left, right, loc };
    }
    return left;
  }

  private parseMultiplicative(): AST.Expr {
    let left = this.parseUnary();
    while (this.atAny('*', '/')) {
      const loc = this.peek().loc;
      const op = this.advance().type as AST.BinaryOp;
      const right = this.parseUnary();
      left = { kind: 'binary', op, left, right, loc };
    }
    return left;
  }

  private parseUnary(): AST.Expr {
    if (this.at('not')) {
      const loc = this.peek().loc;
      this.advance();
      const operand = this.parseUnary();
      return { kind: 'unary', op: 'not', operand, loc };
    }
    if (this.at('-')) {
      const loc = this.peek().loc;
      this.advance();
      const operand = this.parseUnary();
      return { kind: 'unary', op: '-', operand, loc };
    }
    return this.parsePostfix();
  }

  private parsePostfix(): AST.Expr {
    let expr = this.parsePrimary();

    while (true) {
      if (this.at('.')) {
        const loc = this.peek().loc;
        this.advance();
        const field = this.expect('ident').value;

        // Check for method call: .any(x => ...)
        if (this.at('(')) {
          this.advance();
          const args: AST.Expr[] = [];
          while (!this.at(')') && !this.at('eof')) {
            args.push(this.parseExpr());
            if (!this.at(')')) {
              this.expect(',');
            }
          }
          this.expect(')');
          expr = { kind: 'call', callee: { kind: 'field-access', object: expr, field, loc }, args, loc };
        } else {
          expr = { kind: 'field-access', object: expr, field, loc };
        }
      } else if (this.at('(')) {
        const loc = this.peek().loc;
        this.advance();
        const args: AST.Expr[] = [];
        while (!this.at(')') && !this.at('eof')) {
          args.push(this.parseExpr());
          if (!this.at(')')) {
            this.expect(',');
          }
        }
        this.expect(')');
        expr = { kind: 'call', callee: expr, args, loc };
      } else if (this.at('{')) {
        // Join lookup: Entity{field: value}
        const loc = this.peek().loc;
        this.advance();
        const keys: { field: string; value: AST.Expr }[] = [];
        while (!this.at('}') && !this.at('eof')) {
          const field = this.expect('ident').value;
          if (this.at(':')) {
            this.advance();
            const value = this.parseExpr();
            keys.push({ field, value });
          } else {
            // Shorthand: {user} means {user: user}
            keys.push({ field, value: { kind: 'ident', name: field, loc: this.peek().loc } });
          }
          if (!this.at('}')) {
            this.expect(',');
          }
        }
        this.expect('}');

        if (expr.kind === 'ident') {
          expr = { kind: 'join-lookup', entity: expr.name, keys, loc };
        } else {
          throw this.error('join lookup must be on entity name');
        }
      } else {
        break;
      }
    }

    return expr;
  }

  private parsePrimary(): AST.Expr {
    const loc = this.peek().loc;

    if (this.at('(')) {
      this.advance();
      const expr = this.parseExpr();
      this.expect(')');
      return expr;
    }

    if (this.at('number')) {
      const value = parseFloat(this.advance().value);
      return { kind: 'number', value, loc };
    }

    if (this.at('string')) {
      const value = this.advance().value;
      return { kind: 'string', value, loc };
    }

    if (this.at('true')) {
      this.advance();
      return { kind: 'boolean', value: true, loc };
    }

    if (this.at('false')) {
      this.advance();
      return { kind: 'boolean', value: false, loc };
    }

    if (this.at('null')) {
      this.advance();
      return { kind: 'null', loc };
    }

    if (this.at('now')) {
      this.advance();
      return { kind: 'ident', name: 'now', loc };
    }

    if (this.at('config')) {
      this.advance();
      this.expect('/');
      const name = this.expect('ident').value;
      return { kind: 'ident', name: `config/${name}`, loc };
    }

    if (this.at('ident')) {
      const name = this.advance().value;

      // Check for lambda: x => expr
      if (this.at('=>')) {
        this.advance();
        const body = this.parseExpr();
        return { kind: 'lambda', param: name, body, loc };
      }

      // Check for Entity.created(...)
      if (this.at('.') && this.peek(1).type === 'created') {
        this.advance(); // consume '.'
        this.advance(); // consume 'created'
        this.expect('(');
        const fields: { field: string; value: AST.Expr }[] = [];
        while (!this.at(')') && !this.at('eof')) {
          const field = this.expect('ident').value;
          this.expect(':');
          const value = this.parseExpr();
          fields.push({ field, value });
          if (!this.at(')')) {
            this.expect(',');
          }
        }
        this.expect(')');
        return { kind: 'entity-created', entity: name, fields, loc };
      }

      return { kind: 'ident', name, loc };
    }

    if (this.at('[')) {
      // Array literal - parse as call to implicit array constructor
      this.advance();
      const args: AST.Expr[] = [];
      while (!this.at(']') && !this.at('eof')) {
        args.push(this.parseExpr());
        if (!this.at(']')) {
          this.expect(',');
        }
      }
      this.expect(']');
      return { kind: 'call', callee: { kind: 'ident', name: '__array', loc }, args, loc };
    }

    throw this.error(`unexpected token: '${this.peek().type}'`);
  }

  private parseDeferred(): AST.DeferredSpec {
    const loc = this.peek().loc;
    this.expect('deferred');
    const name = this.expect('ident').value;
    // Parse the rest as a string description (simplified)
    let description = '';
    while (!this.atAny('external', 'value', 'entity', 'default', 'rule', 'deferred', 'open', 'eof')) {
      description += this.advance().value + ' ';
    }
    return { name, description: description.trim(), loc };
  }

  private parseOpenQuestion(): AST.OpenQuestion {
    const loc = this.peek().loc;
    this.expect('open');
    this.expect('question');
    // Parse the rest as the question text
    let question = '';
    while (!this.atAny('external', 'value', 'entity', 'default', 'rule', 'deferred', 'open', 'eof')) {
      question += this.advance().value + ' ';
    }
    return { question: question.trim(), loc };
  }
}

export function parse(tokens: Token[], filename: string): ParseResult {
  const parser = new Parser(tokens, filename);
  return parser.parse();
}
