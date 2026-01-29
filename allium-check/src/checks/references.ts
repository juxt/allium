import type * as AST from '../ast.js';
import type { Diagnostic, Loc } from '../types.js';
import { SymbolTable, findSimilar, getAllMembers } from '../symbols.js';

export function checkReferences(file: AST.AlliumFile, symbols: SymbolTable, filename: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const checker = new ReferenceChecker(symbols, filename, diagnostics);

  // Check entity field type references
  for (const entity of file.entities) {
    checker.checkEntityMembers(entity);
  }

  // Check value type field references
  for (const val of file.values) {
    for (const field of val.fields) {
      checker.checkTypeRef(field.type, field.loc);
    }
  }

  // Check external entity field references
  for (const ext of file.externals) {
    for (const field of ext.fields) {
      checker.checkTypeRef(field.type, field.loc);
    }
  }

  // Check rules
  for (const rule of file.rules) {
    checker.checkRule(rule);
  }

  return diagnostics;
}

class ReferenceChecker {
  // Track bound variables in current scope
  private boundVars = new Set<string>();

  constructor(
    private symbols: SymbolTable,
    private filename: string,
    private diagnostics: Diagnostic[]
  ) {}

  private error(line: number, col: number, message: string, suggestion?: string): void {
    this.diagnostics.push({ file: this.filename, line, col, message, suggestion });
  }

  checkEntityMembers(entity: AST.Entity): void {
    const typeInfo = this.symbols.types.get(entity.name);
    if (!typeInfo) return;

    // Check field type references
    for (const field of entity.fields) {
      this.checkTypeRef(field.type, field.loc);
    }

    // Check relationship target entity exists
    for (const rel of entity.relationships) {
      if (!this.symbols.types.has(rel.target)) {
        const suggestion = findSimilar(rel.target, this.symbols.types.keys());
        this.error(rel.loc.line, rel.loc.col, `undefined entity '${rel.target}'`, suggestion);
      }
    }

    // For projections and derived, add entity members to scope
    const members = getAllMembers(typeInfo);
    this.boundVars.clear();
    for (const name of members.keys()) {
      this.boundVars.add(name);
    }

    // Check projection source is a valid relationship
    for (const proj of entity.projections) {
      if (!typeInfo.relationships.has(proj.source)) {
        const suggestion = findSimilar(proj.source, typeInfo.relationships.keys());
        this.error(proj.loc.line, proj.loc.col, `undefined relationship '${proj.source}'`, suggestion);
      }
      // Check filter expression (with entity context)
      this.checkExprInContext(proj.filter, true);
    }

    // Check derived expressions (with entity context)
    for (const der of entity.derived) {
      this.checkExprInContext(der.expr, true);
    }

    this.boundVars.clear();
  }

  checkTypeRef(type: AST.TypeExpr, loc: Loc): void {
    switch (type.kind) {
      case 'entity-ref':
        if (!this.symbols.types.has(type.name)) {
          const suggestion = findSimilar(type.name, this.symbols.types.keys());
          this.error(loc.line, loc.col, `undefined type '${type.name}'`, suggestion);
        }
        break;
      case 'optional':
      case 'set':
      case 'list':
        this.checkTypeRef(type.inner, loc);
        break;
      case 'primitive':
      case 'enum':
        // Always valid
        break;
    }
  }

  checkRule(rule: AST.Rule): void {
    // Reset bound variables for each rule
    this.boundVars.clear();

    // Check trigger and collect bindings
    this.checkTrigger(rule.trigger);

    // Check let bindings
    for (const binding of rule.lets) {
      this.checkExprInContext(binding.expr, false);
      this.boundVars.add(binding.name);
    }

    // Check requires clauses (may contain enum comparisons)
    for (const req of rule.requires) {
      this.checkExprInContext(req, false);
    }

    // Check ensures clauses (often contain enum assignments)
    for (const ens of rule.ensures) {
      this.checkExprInContext(ens, false);
    }
  }

  checkTrigger(trigger: AST.Trigger): void {
    switch (trigger.kind) {
      case 'stimulus':
        // Add params to bound vars
        for (const param of trigger.params) {
          this.boundVars.add(param.name);
        }
        break;

      case 'state-change':
        // Check entity exists
        if (!this.symbols.types.has(trigger.entity)) {
          const suggestion = findSimilar(trigger.entity, this.symbols.types.keys());
          this.error(trigger.loc.line, trigger.loc.col, `undefined entity '${trigger.entity}'`, suggestion);
        } else {
          // Check field exists on entity
          const typeInfo = this.symbols.types.get(trigger.entity)!;
          const members = getAllMembers(typeInfo);
          if (!members.has(trigger.field)) {
            const suggestion = findSimilar(trigger.field, members.keys());
            this.error(trigger.loc.line, trigger.loc.col, `undefined field '${trigger.field}' on entity '${trigger.entity}'`, suggestion);
          }
        }
        // Add binding
        this.boundVars.add(trigger.binding);
        // Check value expression (typically an enum value)
        this.checkExprInContext(trigger.value, true);
        break;

      case 'created':
        // Check entity exists
        if (!this.symbols.types.has(trigger.entity)) {
          const suggestion = findSimilar(trigger.entity, this.symbols.types.keys());
          this.error(trigger.loc.line, trigger.loc.col, `undefined entity '${trigger.entity}'`, suggestion);
        }
        // Add binding
        this.boundVars.add(trigger.binding);
        break;

      case 'temporal':
      case 'derived':
        this.checkExprInContext(trigger.expr, false);
        break;

      case 'chained':
        // Params become bound
        for (const param of trigger.params) {
          this.boundVars.add(param);
        }
        break;
    }
  }

  checkExpr(expr: AST.Expr): void {
    this.checkExprInContext(expr, false);
  }

  // skipEnumLikeIdents: when true, bare identifiers on RHS of = are not flagged (likely enum values)
  checkExprInContext(expr: AST.Expr, skipEnumLikeIdents: boolean): void {
    switch (expr.kind) {
      case 'ident':
        // Check if it's a bound variable, entity, or builtin
        if (!this.boundVars.has(expr.name) &&
            !this.symbols.types.has(expr.name) &&
            !this.isBuiltin(expr.name)) {
          // Skip if this looks like an enum value (lowercase identifier in enum context)
          if (skipEnumLikeIdents && this.looksLikeEnumValue(expr.name)) {
            break;
          }
          const allNames = [...this.boundVars, ...this.symbols.types.keys()];
          const suggestion = findSimilar(expr.name, allNames);
          this.error(expr.loc.line, expr.loc.col, `undefined identifier '${expr.name}'`, suggestion);
        }
        break;

      case 'field-access':
        this.checkExprInContext(expr.object, skipEnumLikeIdents);
        // Field existence check would require type inference - skipped for MVP
        break;

      case 'call':
        this.checkExprInContext(expr.callee, skipEnumLikeIdents);
        // Array literal args are often enum values when skipEnumLikeIdents is set
        const isArrayLiteral = expr.callee.kind === 'ident' && expr.callee.name === '__array';
        for (const arg of expr.args) {
          this.checkExprInContext(arg, skipEnumLikeIdents || isArrayLiteral);
        }
        break;

      case 'binary':
        this.checkExprInContext(expr.left, skipEnumLikeIdents);
        // For equality comparisons and 'in', RHS is likely enum value(s)
        if (expr.op === '=' || expr.op === '!=' || expr.op === 'in') {
          this.checkExprInContext(expr.right, true);
        } else {
          this.checkExprInContext(expr.right, skipEnumLikeIdents);
        }
        break;

      case 'unary':
        this.checkExprInContext(expr.operand, skipEnumLikeIdents);
        break;

      case 'lambda':
        // Add param to scope temporarily
        const hadVar = this.boundVars.has(expr.param);
        this.boundVars.add(expr.param);
        this.checkExprInContext(expr.body, skipEnumLikeIdents);
        if (!hadVar) {
          this.boundVars.delete(expr.param);
        }
        break;

      case 'join-lookup':
        // Check entity exists
        if (!this.symbols.types.has(expr.entity)) {
          const suggestion = findSimilar(expr.entity, this.symbols.types.keys());
          this.error(expr.loc.line, expr.loc.col, `undefined entity '${expr.entity}'`, suggestion);
        }
        // Check key expressions
        for (const key of expr.keys) {
          this.checkExprInContext(key.value, skipEnumLikeIdents);
        }
        break;

      case 'entity-created':
        // Check entity exists
        if (!this.symbols.types.has(expr.entity)) {
          const suggestion = findSimilar(expr.entity, this.symbols.types.keys());
          this.error(expr.loc.line, expr.loc.col, `undefined entity '${expr.entity}'`, suggestion);
        }
        // Check field expressions - RHS values are often enum values
        for (const field of expr.fields) {
          this.checkExprInContext(field.value, true);
        }
        break;

      case 'number':
      case 'string':
      case 'boolean':
      case 'null':
      case 'enum-value':
        // Literals are always valid
        break;
    }
  }

  // Heuristic: lowercase identifiers are likely enum values
  private looksLikeEnumValue(name: string): boolean {
    return /^[a-z][a-z_]*$/.test(name);
  }

  private isBuiltin(name: string): boolean {
    const builtins = ['now', 'true', 'false', 'null', 'verify', 'send', 'notify', '__array'];
    if (builtins.includes(name)) return true;
    if (name.startsWith('config/')) return true;
    return false;
  }
}
