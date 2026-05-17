# Distill inventory schema (v1)

This document defines the structured JSON inventory format that a subagent
produces from a source codebase. The orchestrator (the distill SKILL.md)
spawns K subagents in parallel, each reading this schema and producing one
`inventory.json` file. The orchestrator then canonicalizes, merges, and
translates them via the scripts in `${CLAUDE_PLUGIN_ROOT}/scripts/`.

The inventory is the *single deliverable* of a subagent. Do not write a
`.allium` spec — that is the translator's job.

## Required JSON shape

Every array is sorted alphabetically by `name` (or by `path` for routes and
webhooks). Every record's keys may appear in any order.

```json
{
  "header": {
    "fixture_name": "<PascalCase name derived from the working directory's basename>",
    "source_package": "<root source directory, e.g. app/>"
  },
  "entities": [
    {
      "name": "<class name verbatim from code>",
      "kind": "internal" | "external",
      "fields": [
        {"name": "<field name>", "type_hint": "<Allium type, e.g. String, Integer, Timestamp, Policy, Set<String>>"}
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
      "name": "<function name verbatim, e.g. approve_claim>",
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
      "name": "<function name verbatim, e.g. auto_acknowledge_job>",
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
          "params": [{"name": "<param>", "type_hint": "<as written>"}],
          "return_type": "<type or vendor type verbatim from code>",
          "preconditions": ["<expression that raises if violated, verbatim from code>"],
          "raises": ["<ExceptionName>"]
        }
      ]
    }
  ],
  "value_types": [
    {
      "name": "<class name verbatim, e.g. PaymentResult>",
      "fields": [{"name": "<field>", "type_hint": "<as written>"}],
      "owned_by": "<entity_name or integration_name or null>"
    }
  ],
  "auxiliary_enumerations": [
    {
      "name": "<EnumName verbatim, e.g. PaymentResultStatus>",
      "values": ["v1", "v2"],
      "owned_by": "<entity_name or integration_name or null>"
    }
  ],
  "invariants": [
    {
      "name": "<Camel name describing the property, e.g. ClaimAmountWithinCoverage>",
      "scope": "<entity the invariant ranges over, e.g. Claim>",
      "expression": "<Allium-shaped expression, e.g. amount_claimed_pence <= policy.coverage_limit_pence>",
      "enforced_by": ["<transition_or_rule_name>", "..."]
    }
  ],
  "config": [
    {
      "name": "<config key, snake_case, verbatim from a module-level constant in the code>",
      "type_hint": "Duration | Integer | String | ...",
      "value": "<literal value, verbatim from the code — preserve underscore placement and units>",
      "source": "<file:variable, e.g. app/models.py:STALLED_AFTER>"
    }
  ],
  "routes": [
    {
      "method": "GET" | "POST" | "PUT" | "DELETE" | "PATCH",
      "path": "/...",
      "handler": "<handler function name verbatim>",
      "module": "<source file path verbatim, e.g. app/routes.py>"
    }
  ],
  "webhooks": [
    {"path": "/...", "produces_entity": "<entity name>", "linking_rule": "<short phrase>"}
  ]
}
```

## Top-level conventions

- **Names come verbatim from the code.** Do not paraphrase, normalize or invent names. `Claim` is `Claim`; `policy_number` is `policy_number`; `auto_approval_scheduler` is `auto_approval_scheduler`. Renaming is the largest source of run-to-run variance — eliminate it here.
- **If something is not in the code, do not invent it.** Unsure whether something belongs? Leave it out.
- **Sort every array alphabetically** by `name` (or by `path` for webhooks/routes).
- **Sort fields inside every record alphabetically** (`entities[].fields[]`, `value_types[].fields[]`, `integrations[].operations[].params[]`).
- **Allium types, not Python types.** Use `String, Integer, Timestamp, Set<String>, EntityName`, with `?` suffix for nullable (`Timestamp?`, `Claim?`). Never `str, int, datetime, list[str]`.
- **Numeric literals come from the code verbatim**, including underscore placement (`5_000_000`, `100_000_000`). Do not "renormalise".
- **Reference `config.<name>`** in expressions instead of inlining literals. If a temporal constant exists in the code as a module-level constant, it goes in `config[]` and rules reference `config.X`.

## Section-specific notes

### `entities[].relationships[]` — two forms

- **From-entity form:** `{"name": "...", "target": "OtherEntity", "with": "<filter>"}` → spec line `<name>: <target> with <filter>`. Use when the relationship is the natural many-side traversal from another entity (e.g. `assessments: Assessment with claim = this`).
- **Derived-view form:** `{"name": "...", "from": "another_relationship", "where": "<filter>"}` → spec line `<name>: <from> where <filter>`. Use when filtering an already-declared relationship (e.g. `completed_assessments: assessments where status = completed`).

### `entities[].derived_properties[]`

Each entry is `{name, expression}`. The `expression` is the full RHS the spec will use (e.g. `"now - submitted_at"`, `"status = assessing and (now - last_activity_at) > config.stalled_after"`). Only include derived properties that exist as `@property`-decorated methods (or equivalent computed accessors) in the source code. Do not invent derived properties from rule-precondition combinations.

**Expression grammar — allowed forms only.** Allium does not parse arbitrary query syntax inside an expression. Stick to these shapes:

- **Field access** on `self` or a typed relationship: `submitted_at`, `policy.coverage_limit_pence`, `assessor.name`
- **Arithmetic and comparison**: `+ - <= >= = != and or not in`
- **Built-in aggregations as function calls**: `sum(<collection>.<field>)`, `count(<collection>)`, `min(<collection>.<field>)`, `max(<collection>.<field>)`, `coalesce(<a>, <b>, ...)`
- **Membership tests on a relationship**: `<relationship>.length`, `<relationship>.count > 0`
- **`now`** for the current timestamp
- **`config.<name>`** for any value in the `config[]` array
- **Conditional shape**: `<predicate> implies <consequent>`

**Forbidden inside any expression** (derived properties, `requires`, `ensures` rhs, `let` rhs, `when` rhs, `invariants[].expression`, etc.):

- Inline query forms like `sum p.amount_pence for p in payouts where p.status = paid`, `first c in Claim where ...`, `[x for x in xs]`, `xs.filter(...)`. These are valid in some languages but NOT in Allium. If you need a filtered set, **declare a relationship first** in `relationships[]` using the derived-view form (`{"name": "...", "from": "...", "where": "..."}`), then reference that relationship name in your expression.

**Example translation:** code computes `total_paid = sum(p.amount_pence for p in payouts if p.status == PAID)`. In the inventory:

1. Add a derived view to the entity's `relationships[]`:
   `{"name": "paid_payouts", "from": "payouts", "where": "status = paid"}`
2. Then in `derived_properties[]`:
   `{"name": "total_paid", "expression": "sum(paid_payouts.amount_pence)"}`

Do NOT write `{"name": "total_paid", "expression": "sum p.amount_pence for p in payouts where p.status = paid"}` — that fails the parser.

### `transitions[].body`

- `requires[]` and `ensures[].kind = "assign"` rhs/lhs are written as Allium expressions, not Python. Use `=` (not `==`), `not in` (not `not in`), `null` (not `None`).
- `ensures[].kind` is one of `"assign"`, `"create"`, or `"invoke"`.
- `lets[]` are optional `let <name> = <expr>` bindings. The expression must be a **function-call shape** (`find_X(args)`) or a simple identifier reference — Allium does not accept inline query forms like `first c in Claim where ...` here. If the original code does a query lookup, model it as a black-box function: `find_<let_name>(<args>)`. The orchestrator's translator enforces this defensively.

### `scheduled_jobs[].body.when`

Must match Allium 3 grammar exactly: `<var>: <Type>.<field-expression> <op> <rhs>`. There is **no comma** between the type binding and the condition — the field access chains directly off the type.

- Correct:                 `claim: Claim.submitted_at + config.assessment_sla <= now`
- Wrong (comma):           `claim: Claim, claim.submitted_at + config.assessment_sla <= now`
- Wrong (no trigger field):`claim: Claim`
- Wrong (call on type):    `payout: Payout.coalesce(...)`

If the natural temporal condition contains `coalesce(...)`, arithmetic, or compound logic, **factor it into a derived property** on the relevant entity and reference that derived property in `when:`. Example:

- Wrong: `when: 'payout: Payout, coalesce(payout.last_failure_at, payout.scheduled_at) + config.payout_retry_after <= now'`
- Right: add `{"name": "retry_due_at", "expression": "coalesce(last_failure_at, scheduled_at) + config.payout_retry_after"}` to `entities[Payout].derived_properties[]`, then `when: 'payout: Payout.retry_due_at <= now'`.

If the job fires on a *change* to an entity property rather than a time threshold, the form is `<var>: <Type>.<property>` with no `<op>` or `<rhs>`. Example: `claim: Claim.has_completed_assessment`.

### `integrations[].operations[].preconditions[]`

The *literal text of the check in the code* (e.g. `"amount_pence > 0"`, `"len(account_number) == 8 and account_number.isdigit()"`), not a paraphrase. Each precondition becomes one `@invariant` clause in the corresponding `contract`.

### `value_types[]` and `auxiliary_enumerations[]`

For types that exist in the code but are not primary entities (e.g. `PaymentResult`, `PaymentResultStatus` defined inside `integrations/payment.py`). If the code has them, include them; if not, do not.

### `invariants[]` — derivation rules

Top-level cross-cutting properties of the domain. Derive systematically from:

1. Each transition's `requires` guards that compare entity fields (e.g. `submit_claim`'s `amount_claimed_pence <= policy.coverage_limit_pence` → invariant `ClaimAmountWithinCoverage`).
2. Each transition that sets a field conditionally on the status (e.g. `deny_claim` setting `denial_reason` when `status = denied` → invariant `DeniedClaimsHaveReason`: `status = denied implies denial_reason != null`).
3. Each guarded transition establishing a "before-X-must-have-Y" property (e.g. `approve_claim` requiring a completed assessment → `ApprovedClaimsHaveCompletedAssessment`: `status in {approved, paid} implies has_completed_assessment`).
4. Each amount-tying transition (e.g. `payout.amount_pence == claim.amount_claimed_pence` at scheduling → `PayoutAmountMatchesClaim`).

**Explicitly excluded — do NOT derive invariants from any of these:**

- **FK / existence checks** that the type system already enforces (e.g. `require policy is not None` for a field declared `policy: Policy`). Only *nullable* FK fields can carry a presence-related invariant.
- **Input-validation guards at the transition boundary** (e.g. `require unknown_policy` / `require unknown_assessor`). These describe interface contracts, not domain properties.
- **Format / shape checks on individual fields** (e.g. "account_number is 8 digits"). These belong inside the relevant `contract` as `@invariant`, not as top-level invariants.

## Self-check before emitting

Before saving the inventory, verify:

1. Every array is alphabetically sorted by `name` (or `path`).
2. Every type_hint uses Allium type names with `?` suffix for nullable. No Python types.
3. Every `let`, `requires`, `ensures` rhs, `derived_properties[].expression`, `when` rhs, and `invariants[].expression` uses **only the expression forms in the grammar list** (field access, arithmetic/comparison, built-in aggregation function calls, `<relationship>.length`/`.count`, `now`, `config.<name>`, `implies`). **No inline queries** (`for X in Y where Z`, list comprehensions, `.filter(...)`). If you need a filtered set, declare it as a `relationships[]` derived view first and reference its name.
4. Every `scheduled_jobs[].body.when` matches the `<var>: <Type>.<field> <op> <rhs>` grammar with no comma.
5. Numeric literals match the source code's underscore grouping.
6. `derived_properties[]` only contains entries that exist as `@property` methods in the code.
7. `invariants[]` only contains entries derived per the four rules above; FK/null/format checks are excluded.

Then write the inventory JSON to the path the orchestrator gave you, and stop. Do not write the spec.
