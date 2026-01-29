import type * as AST from '../ast.js';
import type { Diagnostic, Loc } from '../types.js';
import { SymbolTable, findSimilar, getAllMembers } from '../symbols.js';

export function checkEnums(file: AST.AlliumFile, symbols: SymbolTable, filename: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const checker = new EnumChecker(symbols, filename, diagnostics);

  // Check rules for enum assignments and comparisons
  for (const rule of file.rules) {
    checker.checkRule(rule);
  }

  // Check derived values
  for (const entity of file.entities) {
    for (const der of entity.derived) {
      checker.checkExprForEnums(der.expr, entity.name);
    }
  }

  return diagnostics;
}

class EnumChecker {
  constructor(
    private symbols: SymbolTable,
    private filename: string,
    private diagnostics: Diagnostic[]
  ) {}

  private error(line: number, col: number, message: string, suggestion?: string): void {
    this.diagnostics.push({ file: this.filename, line, col, message, suggestion });
  }

  checkRule(rule: AST.Rule): void {
    // Check trigger for enum comparisons
    if (rule.trigger.kind === 'state-change') {
      this.checkEnumAssignment(
        rule.trigger.entity,
        rule.trigger.field,
        rule.trigger.value,
        rule.trigger.loc
      );
    }

    // Check requires clauses
    for (const req of rule.requires) {
      this.checkExprForEnums(req, null);
    }

    // Check ensures clauses
    for (const ens of rule.ensures) {
      this.checkExprForEnums(ens, null);
    }
  }

  checkEnumAssignment(entityName: string, fieldName: string, value: AST.Expr, loc: Loc): void {
    const typeInfo = this.symbols.types.get(entityName);
    if (!typeInfo) return; // Entity doesn't exist - reported by reference check

    const fieldInfo = typeInfo.fields.get(fieldName);
    if (!fieldInfo || !fieldInfo.enumValues) return; // Not an enum field

    // Check if the value is an identifier (enum value)
    if (value.kind === 'ident') {
      if (!fieldInfo.enumValues.includes(value.name)) {
        const suggestion = findSimilar(value.name, fieldInfo.enumValues);
        this.error(
          value.loc.line,
          value.loc.col,
          `invalid enum value '${value.name}' for field '${fieldName}' (expected: ${fieldInfo.enumValues.join(' | ')})`,
          suggestion
        );
      }
    }
  }

  checkExprForEnums(expr: AST.Expr, contextEntity: string | null): void {
    switch (expr.kind) {
      case 'binary':
        // Check for pattern: entity.field = value or field = value
        if (expr.op === '=' || expr.op === '!=') {
          this.checkEnumComparison(expr.left, expr.right);
          this.checkEnumComparison(expr.right, expr.left);
        }
        this.checkExprForEnums(expr.left, contextEntity);
        this.checkExprForEnums(expr.right, contextEntity);
        break;

      case 'unary':
        this.checkExprForEnums(expr.operand, contextEntity);
        break;

      case 'call':
        this.checkExprForEnums(expr.callee, contextEntity);
        for (const arg of expr.args) {
          this.checkExprForEnums(arg, contextEntity);
        }
        break;

      case 'lambda':
        this.checkExprForEnums(expr.body, contextEntity);
        break;

      case 'field-access':
        this.checkExprForEnums(expr.object, contextEntity);
        break;

      case 'entity-created':
        // Check each field assignment
        const typeInfo = this.symbols.types.get(expr.entity);
        if (typeInfo) {
          for (const fieldAssign of expr.fields) {
            const fieldInfo = typeInfo.fields.get(fieldAssign.field);
            if (fieldInfo?.enumValues && fieldAssign.value.kind === 'ident') {
              const valueName = fieldAssign.value.name;
              if (!fieldInfo.enumValues.includes(valueName)) {
                // Only flag if it looks like a typo'd enum value (similar to a valid enum)
                // Skip if it looks like a variable reference (no similarity to enums)
                const suggestion = findSimilar(valueName, fieldInfo.enumValues);
                if (suggestion) {
                  this.error(
                    fieldAssign.value.loc.line,
                    fieldAssign.value.loc.col,
                    `invalid enum value '${valueName}' for field '${fieldAssign.field}' (expected: ${fieldInfo.enumValues.join(' | ')})`,
                    suggestion
                  );
                }
              }
            }
            this.checkExprForEnums(fieldAssign.value, contextEntity);
          }
        }
        break;

      case 'join-lookup':
        for (const key of expr.keys) {
          this.checkExprForEnums(key.value, contextEntity);
        }
        break;

      default:
        // Literals and identifiers don't need recursive checking
        break;
    }
  }

  private checkEnumComparison(fieldSide: AST.Expr, valueSide: AST.Expr): void {
    // Pattern: entity.field = value
    if (fieldSide.kind === 'field-access' && valueSide.kind === 'ident') {
      const entityExpr = fieldSide.object;
      const fieldName = fieldSide.field;
      const valueName = valueSide.name;

      // Try to resolve the entity type
      const entityType = this.resolveEntityType(entityExpr);
      if (entityType) {
        const fieldInfo = entityType.fields.get(fieldName);
        if (fieldInfo?.enumValues && !fieldInfo.enumValues.includes(valueName)) {
          // Make sure it's not a variable reference (heuristic: lowercase = variable)
          if (valueName[0] === valueName[0].toLowerCase() && /^[a-z]/.test(valueName)) {
            // Likely a variable, skip
            return;
          }
          const suggestion = findSimilar(valueName, fieldInfo.enumValues);
          this.error(
            valueSide.loc.line,
            valueSide.loc.col,
            `invalid enum value '${valueName}' for field '${fieldName}' (expected: ${fieldInfo.enumValues.join(' | ')})`,
            suggestion
          );
        }
      }
    }
  }

  private resolveEntityType(expr: AST.Expr): ReturnType<typeof this.symbols.types.get> | null {
    // Simple cases: direct entity reference
    if (expr.kind === 'ident') {
      return this.symbols.types.get(expr.name) ?? null;
    }

    // For field access, we'd need full type inference - skip for MVP
    return null;
  }
}
