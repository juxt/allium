---
globs: "**/*.allium"
---

# Allium language

Allium is a behavioural specification language for describing what systems should do, not how they do it. It has no compiler or runtime; LLMs and humans interpret it directly.

## File structure

Every `.allium` file starts with `-- allium: N` where N is the current language version. Sections follow a fixed order: use declarations, given, external entities, value types, enumerations, entities and variants, config, defaults, rules, actor declarations, surfaces, deferred specifications, open questions. Omit empty sections. Section headers use comment dividers (`----`).

## Syntax distinctions that trip up models

**`with` vs `where`** — `with` declares relationships (`slots: InterviewSlot with candidacy = this`), `where` filters projections (`confirmed_slots: slots where status = confirmed`). Swapping them is a type error.

**`transitions_to` vs `becomes`** — Both are trigger types. `transitions_to` fires when a field changes to a value from a different value, not on initial creation. `becomes` fires both on creation with that value and on transition to it. Use `becomes` when the rule should apply regardless of how the entity reached the state.

**Capitalised vs lowercase pipe values** — Capitalised values are variant references (`kind: Branch | Leaf`), lowercase values are enum literals (`status: pending | active`). The validator checks that capitalised names correspond to `variant` declarations.

**`.created()` for entity creation** — New entities are expressed as `EntityName.created(field: value)` in `ensures` clauses. Variant instances must use the variant name, not the base entity.

**Temporal triggers need `requires` guards** — Temporal triggers fire once when the condition becomes true, but without a guard they can re-fire if the entity remains in a qualifying state. Always pair with `requires: token.status = active` or equivalent to prevent re-firing.

**`now` evaluation model** — In derived values, `now` re-evaluates on each read (volatile). In `ensures` clauses, `now` is bound to rule execution timestamp (snapshot). In temporal triggers, `now` is the evaluation timestamp with fire-once semantics.

**Naming conventions** — PascalCase for entities, variants, rules, triggers, actors, surfaces. snake_case for fields, config parameters, derived values, enum literals.

## Anti-patterns

**Implementation leakage** — Specs describe observable behaviour, not databases, APIs or services. If a field name implies a storage mechanism (`database_id`, `api_response`), rephrase it.

**Missing temporal guards** — Every temporal trigger (`field <= now`, `field + duration <= now`) needs a `requires` clause to prevent infinite re-firing.

**Magic numbers** — Variable values belong in `config` blocks, not hardcoded in rules. Use `config.max_attempts` rather than literal `5`.

**Implicit lambdas** — Collection operations use explicit parameter syntax: `interviewers.any(i => i.can_solo)`, not `interviewers.any(can_solo)`.

**Overly broad enums** — If an inline enum appears on multiple fields that need comparison, extract a named `enum`. Inline enums are anonymous and cannot be compared across fields.

**Inline enum comparison** — Two inline enum fields cannot be compared even if they share the same literals. The checker reports an error. Extract a named enum when values need comparison across fields.

## Reference

See `references/language-reference.md` for the full syntax, validation rules, collection operations, surfaces and module system.
