import type { Loc } from './types.js';

// Top-level file
export type AlliumFile = {
  externals: ExternalEntity[];
  values: ValueType[];
  entities: Entity[];
  defaults: Default[];
  rules: Rule[];
  deferred: DeferredSpec[];
  openQuestions: OpenQuestion[];
};

// External entity (managed outside this spec)
export type ExternalEntity = {
  kind: 'external';
  name: string;
  fields: Field[];
  loc: Loc;
};

// Value type (no identity, compared by value)
export type ValueType = {
  kind: 'value';
  name: string;
  fields: Field[];
  loc: Loc;
};

// Entity (has identity, managed by spec)
export type Entity = {
  kind: 'entity';
  name: string;
  fields: Field[];
  relationships: Relationship[];
  projections: Projection[];
  derived: Derived[];
  loc: Loc;
};

// Field on entity/value
export type Field = {
  name: string;
  type: TypeExpr;
  loc: Loc;
};

// Type expression
export type TypeExpr =
  | { kind: 'primitive'; name: string }
  | { kind: 'entity-ref'; name: string }
  | { kind: 'enum'; values: string[] }
  | { kind: 'optional'; inner: TypeExpr }
  | { kind: 'set'; inner: TypeExpr }
  | { kind: 'list'; inner: TypeExpr };

// Relationship to another entity
export type Relationship = {
  name: string;
  target: string; // entity name (singular)
  condition: string; // "for this user" etc
  loc: Loc;
};

// Projection (filtered relationship)
export type Projection = {
  name: string;
  source: string; // relationship name
  filter: Expr;
  loc: Loc;
};

// Derived value (computed)
export type Derived = {
  name: string;
  expr: Expr;
  loc: Loc;
};

// Default config value
export type Default = {
  name: string;
  value: Expr;
  loc: Loc;
};

// Rule
export type Rule = {
  name: string;
  trigger: Trigger;
  lets: LetBinding[];
  requires: Expr[];
  ensures: Expr[];
  loc: Loc;
};

// Trigger types
export type Trigger =
  | { kind: 'stimulus'; name: string; params: Param[]; loc: Loc }
  | { kind: 'state-change'; binding: string; entity: string; field: string; value: Expr; loc: Loc }
  | { kind: 'temporal'; expr: Expr; loc: Loc }
  | { kind: 'derived'; expr: Expr; loc: Loc }
  | { kind: 'created'; binding: string; entity: string; loc: Loc }
  | { kind: 'chained'; name: string; params: string[]; loc: Loc };

export type Param = {
  name: string;
  optional: boolean;
  loc: Loc;
};

export type LetBinding = {
  name: string;
  expr: Expr;
  loc: Loc;
};

// Expressions
export type Expr =
  | { kind: 'ident'; name: string; loc: Loc }
  | { kind: 'number'; value: number; loc: Loc }
  | { kind: 'string'; value: string; loc: Loc }
  | { kind: 'boolean'; value: boolean; loc: Loc }
  | { kind: 'null'; loc: Loc }
  | { kind: 'enum-value'; value: string; loc: Loc }
  | { kind: 'field-access'; object: Expr; field: string; loc: Loc }
  | { kind: 'call'; callee: Expr; args: Expr[]; loc: Loc }
  | { kind: 'binary'; op: BinaryOp; left: Expr; right: Expr; loc: Loc }
  | { kind: 'unary'; op: UnaryOp; operand: Expr; loc: Loc }
  | { kind: 'lambda'; param: string; body: Expr; loc: Loc }
  | { kind: 'join-lookup'; entity: string; keys: { field: string; value: Expr }[]; loc: Loc }
  | { kind: 'entity-created'; entity: string; fields: { field: string; value: Expr }[]; loc: Loc };

export type BinaryOp =
  | '=' | '!=' | '<' | '<=' | '>' | '>='
  | '+' | '-' | '*' | '/'
  | 'and' | 'or'
  | 'in' | 'with';

export type UnaryOp = 'not' | '-';

// Deferred specification
export type DeferredSpec = {
  name: string;
  description: string;
  location?: string;
  loc: Loc;
};

// Open question
export type OpenQuestion = {
  question: string;
  loc: Loc;
};
