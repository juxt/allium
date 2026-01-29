import type * as AST from './ast.js';

// Symbol table for semantic analysis
export type SymbolTable = {
  // All known type names (entities, values, externals)
  types: Map<string, TypeInfo>;
  // All known defaults
  defaults: Map<string, AST.Default>;
  // All rules
  rules: Map<string, AST.Rule>;
};

export type TypeInfo = {
  kind: 'entity' | 'value' | 'external';
  name: string;
  fields: Map<string, FieldInfo>;
  relationships: Map<string, RelationshipInfo>;
  projections: Map<string, ProjectionInfo>;
  derived: Map<string, DerivedInfo>;
  node: AST.Entity | AST.ValueType | AST.ExternalEntity;
};

export type FieldInfo = {
  name: string;
  type: AST.TypeExpr;
  enumValues?: string[]; // If type is enum, the allowed values
};

export type RelationshipInfo = {
  name: string;
  target: string;
  condition: string;
};

export type ProjectionInfo = {
  name: string;
  source: string;
  filter: AST.Expr;
};

export type DerivedInfo = {
  name: string;
  expr: AST.Expr;
};

export function buildSymbols(file: AST.AlliumFile): SymbolTable {
  const types = new Map<string, TypeInfo>();
  const defaults = new Map<string, AST.Default>();
  const rules = new Map<string, AST.Rule>();

  // Process external entities
  for (const ext of file.externals) {
    types.set(ext.name, {
      kind: 'external',
      name: ext.name,
      fields: buildFieldMap(ext.fields),
      relationships: new Map(),
      projections: new Map(),
      derived: new Map(),
      node: ext,
    });
  }

  // Process value types
  for (const val of file.values) {
    types.set(val.name, {
      kind: 'value',
      name: val.name,
      fields: buildFieldMap(val.fields),
      relationships: new Map(),
      projections: new Map(),
      derived: new Map(),
      node: val,
    });
  }

  // Process entities
  for (const ent of file.entities) {
    const fields = buildFieldMap(ent.fields);
    const relationships = new Map<string, RelationshipInfo>();
    const projections = new Map<string, ProjectionInfo>();
    const derived = new Map<string, DerivedInfo>();

    for (const rel of ent.relationships) {
      relationships.set(rel.name, {
        name: rel.name,
        target: rel.target,
        condition: rel.condition,
      });
    }

    for (const proj of ent.projections) {
      projections.set(proj.name, {
        name: proj.name,
        source: proj.source,
        filter: proj.filter,
      });
    }

    for (const der of ent.derived) {
      derived.set(der.name, {
        name: der.name,
        expr: der.expr,
      });
    }

    types.set(ent.name, {
      kind: 'entity',
      name: ent.name,
      fields,
      relationships,
      projections,
      derived,
      node: ent,
    });
  }

  // Process defaults
  for (const def of file.defaults) {
    defaults.set(def.name, def);
  }

  // Process rules
  for (const rule of file.rules) {
    rules.set(rule.name, rule);
  }

  return { types, defaults, rules };
}

function buildFieldMap(fields: AST.Field[]): Map<string, FieldInfo> {
  const map = new Map<string, FieldInfo>();
  for (const field of fields) {
    const info: FieldInfo = {
      name: field.name,
      type: field.type,
    };
    if (field.type.kind === 'enum') {
      info.enumValues = field.type.values;
    }
    map.set(field.name, info);
  }
  return map;
}

// Helper to get all members (fields, relationships, projections, derived) of a type
export function getAllMembers(typeInfo: TypeInfo): Map<string, 'field' | 'relationship' | 'projection' | 'derived'> {
  const members = new Map<string, 'field' | 'relationship' | 'projection' | 'derived'>();

  for (const name of typeInfo.fields.keys()) {
    members.set(name, 'field');
  }
  for (const name of typeInfo.relationships.keys()) {
    members.set(name, 'relationship');
  }
  for (const name of typeInfo.projections.keys()) {
    members.set(name, 'projection');
  }
  for (const name of typeInfo.derived.keys()) {
    members.set(name, 'derived');
  }

  return members;
}

// Find similar names for "did you mean" suggestions
export function findSimilar(name: string, candidates: Iterable<string>, maxDistance = 2): string | undefined {
  let best: string | undefined;
  let bestDist = maxDistance + 1;

  for (const candidate of candidates) {
    const dist = levenshtein(name.toLowerCase(), candidate.toLowerCase());
    if (dist < bestDist) {
      bestDist = dist;
      best = candidate;
    }
  }

  return best;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }

  return dp[m][n];
}
