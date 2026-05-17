# Distill inventory schema (v1)

This document defines the structured JSON inventory format that a subagent
produces from a source codebase. The orchestrator (the distill SKILL.md)
spawns K subagents in parallel, each reading this schema and producing one
`inventory.json` file. The orchestrator then canonicalises, merges and
translates them via the scripts in `${CLAUDE_PLUGIN_ROOT}/scripts/`.

The inventory is the *single deliverable* of a subagent. Do not write a
`.allium` spec — that is the translator's job.

## Translation principle

The inventory contains only Allium constructs and Allium expressions. The
source code may be in any language. **If a source-language idiom has no
direct Allium equivalent, model the behaviour in Allium, not the syntax.**

Worked translations of behaviour, not syntax:

- A conditional value (whatever its source-language form — ternary, `if/else`,
  pattern match, switch, guard) → an Allium `case ... when ... otherwise`
  expression *or* a derived property the inventory declares on the entity,
  then reference the derived property from the rule body. Do not embed
  source-language conditional syntax in expressions.
- A query / set-builder / list comprehension / filter call → a `relationships[]`
  derived view (`{"name": "...", "from": "...", "where": "..."}`) declared on
  the owning entity, referenced by name from expressions that need it. Do
  not embed query syntax in expressions.
- A divisibility / modulo check → a derived helper that compares a remainder
  computed with `-` and `/` against `0`, or a black-box function call
  (`is_multiple_of(quantity, lot_size)`) with `@guidance` describing intent.
  Allium has no `%` operator.
- A null/optional check on a typed reference field → simply rely on the
  type's nullability (`X?`). Allium does not need `is not None` / `is some`
  guards for fields the type system already declares non-nullable.

The general shape: read the source, identify the **behaviour**, look up
the corresponding **Allium construct** below, populate the inventory with
that construct. Never paste source-language syntax through.

## Required JSON shape

Every array is sorted alphabetically by `name` (or by `path` for routes and
webhooks). Every record's keys may appear in any order.

```json
{
  "header": {
    "fixture_name": "<PascalCase name derived from the working directory's basename>",
    "source_package": "<root source directory, e.g. app/ or src/>"
  },
  "entities": [
    {
      "name": "<class/struct/record name verbatim from source>",
      "kind": "internal" | "external",
      "fields": [
        {"name": "<field name>", "type_hint": "<Allium type, see catalogue below>"}
      ],
      "status_enum": {"name": "<EnumName>", "values": ["v1", "v2"]} | null,
      "relationships": [
        {"name": "assessments", "target": "Assessment", "with": "claim = this"},
        {"name": "completed_assessments", "from": "assessments", "where": "status = completed"}
      ],
      "derived_properties": [
        {"name": "is_stalled", "expression": "status = assessing and (now - last_activity_at) > config.stalled_after"}
      ],
      "guidance": "<optional one-line prose about the entity; null if no clarification needed>"
    }
  ],
  "transitions": [
    {
      "name": "<function/method name verbatim, e.g. approve_claim>",
      "entity": "<entity it primarily mutates, e.g. Claim>",
      "called_from": ["<file>:<caller>", "..."],
      "body": {
        "params": [{"name": "claim", "type_hint": "Claim"}],
        "lets": [{"name": "<binding>", "expression": "<function-call form, e.g. find_match(policy, date)>"}],
        "requires": ["<guard expression>", "..."],
        "ensures": [
          {"kind": "assign", "lhs": "claim.status", "rhs": "approved"},
          {"kind": "assign", "lhs": "claim.last_activity_at", "rhs": "now"},
          {"kind": "create", "entity": "Payout", "fields": {"claim": "claim", "amount_pence": "claim.amount_claimed_pence", "status": "scheduled", "scheduled_at": "now", "failed_attempts": "0"}},
          {"kind": "invoke", "trigger": "SchedulePayout", "args": {"claim": "claim"}}
        ]
      },
      "guidance": "<optional prose explaining edge cases or semantic intent; null if obvious>"
    }
  ],
  "scheduled_jobs": [
    {
      "name": "<function/method name verbatim, e.g. auto_acknowledge_job>",
      "body": {
        "when": "<temporal trigger expression, e.g. claim: Claim.submitted_at + config.auto_ack_after <= now>",
        "requires": ["<guard>"],
        "ensures": [{"kind": "assign", "lhs": "...", "rhs": "..."}],
        "post_invocations": []
      },
      "guidance": "<optional prose>"
    }
  ],
  "integrations": [
    {
      "name": "<module name verbatim, e.g. payment>",
      "purpose": "<one short phrase>",
      "operations": [
        {
          "name": "<function name verbatim>",
          "params": [{"name": "<param>", "type_hint": "<Allium type>"}],
          "return_type": "<Allium type>",
          "preconditions": ["<Allium expression that must hold; raises if violated>"],
          "raises": ["<ExceptionName>"]
        }
      ]
    }
  ],
  "value_types": [
    {
      "name": "<class/struct/record name verbatim>",
      "fields": [{"name": "<field>", "type_hint": "<Allium type>"}],
      "owned_by": "<entity_name or integration_name or null>"
    }
  ],
  "auxiliary_enumerations": [
    {
      "name": "<EnumName verbatim>",
      "values": ["v1", "v2"],
      "owned_by": "<entity_name or integration_name or null>"
    }
  ],
  "invariants": [
    {
      "name": "<Camel name describing the property, e.g. ClaimAmountWithinCoverage>",
      "scope": "<entity the invariant ranges over, e.g. Claim>",
      "expression": "<Allium expression>",
      "enforced_by": ["<transition_or_rule_name>", "..."]
    }
  ],
  "config": [
    {
      "name": "<config key, snake_case, verbatim from a module-level constant in the code>",
      "type_hint": "Duration | Integer | Decimal | String | Boolean | ...",
      "value": "<literal value verbatim, including digit-grouping if the source had it>",
      "source": "<file:variable, e.g. app/models.py:STALLED_AFTER>"
    }
  ],
  "routes": [
    {
      "method": "GET" | "POST" | "PUT" | "DELETE" | "PATCH",
      "path": "/...",
      "handler": "<handler function name verbatim>",
      "module": "<source file path verbatim>"
    }
  ],
  "webhooks": [
    {"path": "/...", "produces_entity": "<entity name>", "linking_rule": "<short phrase>"}
  ]
}
```

## Allium type catalogue

Every `type_hint` in the inventory is an Allium type, not a source-language
type. The catalogue is closed:

- **Primitives:** `String`, `Integer`, `Decimal`, `Boolean`
- **Time:** `Timestamp`, `Duration`
- **Collections:** `List<T>`, `Set<T>`, `Map<K, V>`
- **Entity reference:** `<EntityName>` (any entity in `entities[]`, value type
  in `value_types[]`, or external entity)
- **Optional:** suffix `?` on any of the above (e.g. `Timestamp?`, `Claim?`)

### Literal formats

Inventory `value`, `expression`, `rhs` and `fields[].<value>` strings can carry
typed literals. Use the Allium literal syntax exactly:

- **Integer:** bare digits, optionally with `_` digit-grouping carried from
  the source (`100`, `50_000_00`, `1_000_000_000`).
- **Decimal:** digits with a decimal point (`0.5`, `1.0`, `100.25`).
- **String:** double-quoted (`"trusted"`).
- **Boolean / null:** lowercase keywords (`true`, `false`, `null`).
- **Duration:** `<number>.<unit>` — the unit is part of the literal, prefixed
  by a period. Valid units: `seconds`, `minutes`, `hours`, `days`, `weeks`.
  Examples: `14.days`, `5.hours`, `2.weeks`, `90.days`. **Never** write
  `14 days` (space) or `14d` (abbreviated) or `Duration(days=14)` — those
  forms do not parse.
- **Enum literal:** lowercase snake_case bare identifier (`active`, `paid`),
  matching the values listed in the entity's `status_enum.values[]`.
- **Set literal:** `{a, b, c}` with bare enum values.
- **`now`:** the bare identifier — no parentheses.

In particular every `config[].value` whose `type_hint` is `Duration` is
written with the dot-unit form: `"value": "14.days"`. Same in any expression
that combines a config reference with a duration (`config.assessment_sla`
is fine; if you ever need to write a literal duration in an expression,
use the dot-unit form).

Map any source-language type you encounter to the closest Allium type by
its **meaning**, not its name. Numeric types with fractional precision are
`Decimal`; whole numbers are `Integer`. Date / datetime / instant types are
`Timestamp`. Time-spans / durations are `Duration`. Boolean-shaped types
are `Boolean`. There is no `Float`, no `Long`, no `Double`, no source-language
type-name passthrough.

## Allium expression grammar

Expressions appear inside `derived_properties[].expression`,
`transitions[].body.requires[]`, `transitions[].body.ensures[]` (rhs of
`assign`), `transitions[].body.lets[].expression`,
`scheduled_jobs[].body.when` and `requires`/`ensures`,
`invariants[].expression`, and `integrations[].operations[].preconditions[]`.

Allium expressions are composed only of:

- **Field access** on `self` or a typed reference: `submitted_at`,
  `policy.coverage_limit_pence`, `assessor.name`
- **Arithmetic:** `+`, `-`, `*`, `/`. No other arithmetic operators.
- **Comparison:** `=` (not `==`), `!=`, `<`, `<=`, `>`, `>=`, `in`, `not in`
- **Boolean:** `and`, `or`, `not`
- **Built-in aggregation functions on a relationship name:**
  `sum(<relationship>.<field>)`, `count(<relationship>)`,
  `min(<relationship>.<field>)`, `max(<relationship>.<field>)`,
  `coalesce(<a>, <b>, ...)`, `abs(<x>)`
- **Membership tests on a relationship:** `<relationship>.length`,
  `<relationship>.count > 0`
- **Implication (invariant-shaped):** `<predicate> implies <consequent>`
- **Reserved identifiers:** `now`, `null`, `true`, `false`, `config.<name>`

Anything not in the above list is **not** an Allium expression. In
particular: no inline conditional expressions of any kind (ternaries,
`if`-expressions, `case`/`when`/`switch`/`match`, guarded values), no
query / comprehension / filter syntax, no modulo or exponentiation, no
method calls on collections beyond the listed aggregation functions.

**Conditional values must be modelled as derived properties.** If you
encounter a place where the source code computes a value based on a
condition (whatever the source-language syntax), do not try to express
the conditional in the inventory expression. Instead:

1. Add a derived property to the relevant entity whose `expression` uses
   only the allowed grammar (typically a comparison or boolean composition
   that resolves to the desired value).
2. Reference that derived property from the spot that needs the value.

Worked example: source code computes `signed = quantity if side == BUY else -quantity`.

- Wrong (inline conditional): `let signed = case side when buy then quantity otherwise 0 - quantity end`
- Wrong (inline conditional): `let signed = if side = buy then quantity else 0 - quantity`
- Right: declare `{"name": "signed_fill_quantity", "expression": "quantity * (1 - 2 * (side != buy))"}` on the entity, OR split the transition into two (one per branch with appropriate `requires:` guards), OR model the choice with a black-box function and rely on `@guidance` to describe it.

When in doubt, prefer the derived-property approach — it is the most
general and never trips the parser.

## Allium construct catalogue (one section per top-level kind)

### `entities[]`

A record of stateful, identifiable things in the domain. `kind: "internal"`
means the system owns the lifecycle; `kind: "external"` means a third-party
feed pushes them in (webhook, message, etc.) and the system only receives
and links.

### `entities[].relationships[]` — two forms

- **From-entity form:** `{"name": "...", "target": "OtherEntity", "with": "<filter>"}`
  emits `<name>: <target> with <filter>`. Use when the relationship is the
  natural many-side traversal from another entity (e.g. `assessments: Assessment with claim = this`).
- **Derived-view form:** `{"name": "...", "from": "another_relationship", "where": "<filter>"}`
  emits `<name>: <from> where <filter>`. Use when filtering an already-declared
  relationship (e.g. `completed_assessments: assessments where status = completed`).

### `entities[].derived_properties[]`

Each entry is `{name, expression}`. `expression` is an Allium expression
(see grammar above). Only include derived properties that exist as computed
accessors in the source code (`@property` in Python, computed properties /
getters in TS/Java/etc., or equivalent). Do not invent derived properties
from rule-precondition combinations.

### `transitions[]`

State-changing operations on an entity. Each transition has a `body` with:

- `params` — sorted alphabetically, each `{name, type_hint}`
- `lets` — optional intermediate bindings; each `expression` is a simple
  identifier or a function-call shape (`find_X(args)`). Allium does not
  accept query forms here.
- `requires` — list of Allium predicate expressions that must hold
- `ensures` — ordered list of effects, each tagged with `kind`:
  - `"assign"` `{lhs, rhs}` — field-level assignment
  - `"create"` `{entity, fields}` — create a new entity, `fields` keyed by field name
  - `"invoke"` `{trigger, args}` — fire another named transition

### `scheduled_jobs[].body.when`

The temporal trigger header. Must match Allium 3 grammar exactly:
`<var>: <Type>.<field-expression> <op> <rhs>` — type-binding chains directly
into a field access, no comma between the type and the condition. Correct:
`claim: Claim.submitted_at + config.assessment_sla <= now`. Wrong:
`claim: Claim, claim.submitted_at + config.assessment_sla <= now`.

If the natural condition would require a function call on the type or compound
logic in the trigger header, **factor it into a derived property on the entity**
and reference that derived property in `when`. Example:

- Wrong: `payout: Payout.coalesce(payout.last_failure_at, payout.scheduled_at) + config.payout_retry_after <= now`
- Right: declare `{"name": "retry_due_at", "expression": "coalesce(last_failure_at, scheduled_at) + config.payout_retry_after"}` in `entities[Payout].derived_properties[]`, then `when: payout: Payout.retry_due_at <= now`.

If the job fires on a *change* to an entity property rather than a time threshold,
the form is `<var>: <Type>.<property>` with no `<op>` or `<rhs>`. Example:
`claim: Claim.has_completed_assessment` (fires when `has_completed_assessment`
becomes true on any claim).

### `integrations[]`

Third-party services / libraries the system calls into. Each operation has
typed `params`, a `return_type`, and a list of `preconditions[]` — each
precondition is an Allium expression that must hold (i.e. the operation's
contract). Preconditions become `@invariant` clauses inside the corresponding
`contract` in the spec.

### `value_types[]` and `auxiliary_enumerations[]`

Types that exist in the code but aren't primary entities — for example, the
shape of a third-party API's request/response object, or an enumeration
used only inside an integration. These become `value` and `enum` declarations
respectively. Include them when the source code defines them; do not invent.

### `invariants[]` — derivation rules

Top-level cross-cutting properties of the domain. Derive systematically from:

1. Each transition's `requires` guards that compare entity fields (e.g.
   `submit_claim`'s `amount_claimed_pence <= policy.coverage_limit_pence` →
   invariant `ClaimAmountWithinCoverage`).
2. Each transition that sets a field conditionally on the status (e.g.
   `deny_claim` setting `denial_reason` when `status = denied` → invariant
   `DeniedClaimsHaveReason`: `status = denied implies denial_reason != null`).
3. Each guarded transition establishing a "before-X-must-have-Y" property
   (e.g. `approve_claim` requiring a completed assessment →
   `ApprovedClaimsHaveCompletedAssessment`:
   `status in {approved, paid} implies has_completed_assessment`).
4. Each amount-tying transition (e.g. `payout.amount_pence == claim.amount_claimed_pence`
   at scheduling → `PayoutAmountMatchesClaim`).

**Explicitly excluded — do NOT derive invariants from any of these:**

- **FK / existence checks** that the type system already enforces (e.g. a
  required-presence check on a field declared with a non-nullable typed
  reference is redundant — the type already states it). Only **nullable**
  reference fields can carry a presence-related invariant.
- **Input-validation guards at the transition boundary** (e.g. a check that
  the supplied input refers to a known entity). These describe interface
  contracts, not domain properties.
- **Format / shape checks on individual fields** (e.g. "account_number is 8
  digits"). These belong inside the relevant `contract` as `@invariant`, not
  as top-level invariants.

## Top-level conventions

- **Names come verbatim from the source code.** Do not paraphrase, normalize
  or invent. The biggest single source of run-to-run variance is renaming —
  eliminate it here.
- **If something is not in the code, do not invent it.** Unsure whether
  something belongs? Leave it out.
- **Sort every array alphabetically** by `name` (or by `path` for webhooks
  and routes).
- **Sort fields inside every record alphabetically** (`entities[].fields[]`,
  `value_types[].fields[]`, `integrations[].operations[].params[]`, etc.).
- **Numeric literals come from the source verbatim**, including digit-grouping
  if the source used it (`5_000_000`, `100_000_000`). Do not "renormalise".
- **Reference `config.<name>` in expressions** rather than inlining literals.
  If a temporal or business constant exists as a module-level constant in the
  source, it goes in `config[]` and rules reference `config.X`.

## Self-check before emitting

Before saving the inventory, verify:

1. Every array is alphabetically sorted by `name` (or `path`).
2. Every `type_hint` is from the Allium type catalogue. No source-language
   type names anywhere.
3. Every expression (in `requires`, `ensures`, `lets`, `when`,
   `derived_properties`, `invariants`, `preconditions`) is built only from
   the Allium expression grammar. No source-language conditionals, queries,
   modulo, or method calls.
4. Every `scheduled_jobs[].body.when` matches the
   `<var>: <Type>.<field> <op> <rhs>` grammar with no comma.
5. Numeric literals match the source's digit-grouping.
6. `derived_properties[]` only contains entries that exist as computed
   accessors in the source.
7. `invariants[]` only contains entries derived per the four rules above;
   FK / null / format checks are excluded.
8. Every transition's `body.params` is non-empty (or explicitly empty `[]`);
   every name referenced in `body.requires`/`ensures`/`lets` is either a
   declared param, a let binding, a field on the entity reached through a
   declared param, `now`, `null`, `true`/`false`, or `config.<name>`. **No
   free names.** This is the most common spec-validity bug — verify each
   identifier in every expression resolves through one of these channels.

   Worked example of the rule:

   ```json
   // WRONG — `limit` is referenced but not declared as a param, let, or
   // field. The translator will pass this through and the spec will fail
   // allium check with "references 'limit' but no matching binding".
   {
     "name": "evaluate_limit_breach",
     "entity": "Trader",
     "body": {
       "params": [{"name": "trader", "type_hint": "Trader"}],
       "lets": [],
       "requires": ["limit.is_breached"],
       "ensures": [{"kind": "assign", "lhs": "limit.status", "rhs": "breached"}]
     }
   }

   // RIGHT — `limit` is a declared param, so all references resolve.
   {
     "name": "evaluate_limit_breach",
     "entity": "Trader",
     "body": {
       "params": [
         {"name": "trader", "type_hint": "Trader"},
         {"name": "limit", "type_hint": "RiskLimit"}
       ],
       "lets": [],
       "requires": ["limit.is_breached"],
       "ensures": [{"kind": "assign", "lhs": "limit.status", "rhs": "breached"}]
     }
   }
   ```

   When a transition operates on entities other than the one named in
   `entity`, those entities must appear as `params`. The `entity` field
   only names which entity the transition primarily mutates; everything
   else it touches must be passed in as a parameter.

   **Chained field access — always write the full param chain.** When the
   field you want lives on an entity reachable from a declared param via
   a relationship, write the full path through the param. Never elide the
   param prefix even when the relationship name is obvious from context.

   ```json
   // WRONG — `claim.last_activity_at` looks like it refers to a bare
   // identifier `claim`, but `claim` is not a declared param. The
   // parser only sees `assessment` (the declared param) and an
   // undeclared `claim`. allium check will reject this as
   // "Rule X references 'claim' but no matching binding exists".
   {
     "name": "complete_assessment",
     "entity": "Assessment",
     "body": {
       "params": [
         {"name": "assessment", "type_hint": "Assessment"},
         {"name": "findings", "type_hint": "String"}
       ],
       "lets": [],
       "requires": ["assessment.status = in_progress"],
       "ensures": [
         {"kind": "assign", "lhs": "assessment.status", "rhs": "completed"},
         {"kind": "assign", "lhs": "assessment.findings", "rhs": "findings"},
         {"kind": "assign", "lhs": "claim.last_activity_at", "rhs": "now"}   // BARE NAME
       ]
     }
   }

   // RIGHT — write the full chain through the declared param.
   // `assessment.claim.last_activity_at` resolves cleanly.
   {
     ...same as above except...
     "ensures": [
       {"kind": "assign", "lhs": "assessment.status", "rhs": "completed"},
       {"kind": "assign", "lhs": "assessment.findings", "rhs": "findings"},
       {"kind": "assign", "lhs": "assessment.claim.last_activity_at", "rhs": "now"}
     ]
   }
   ```

   Same rule applies on the rhs of an assign, inside `requires` predicates,
   and inside `lets` expressions. Every identifier resolves through a
   declared param, a let binding, `now`/`null`/`true`/`false`, or
   `config.<name>` — and field access is always written `<chain>.<field>`,
   never bare.

Then write the inventory JSON to the path the orchestrator gave you, and stop.
Do not write the spec.
