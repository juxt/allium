# Impact map reference

The impact map is a JSON artifact produced by the [`impact` skill](../skills/impact/SKILL.md) that links Allium spec constructs to implementation code symbols. This document defines the schema and the integration contract that other Allium skills read.

## File location

One JSON file per spec, under the target project's `.allium/impact/` directory:

```text
<project>/
  spec.allium
  .allium/
    impact/
      .gitignore         # contains "*", committed so the directory is tracked but contents are not
      spec.json
```

The directory is a gitignored cache. The skill writes `.gitignore` on first build. Do not commit impact map files.

## Top-level schema

```json
{
  "spec": "spec.allium",
  "language": "python",
  "commit": "<git-sha-at-build-time>",
  "built_at": "<ISO-8601 timestamp>",
  "adapter_version": "python-v1",
  "nodes": { ... },
  "links": [ ... ],
  "call_edges": [ ... ],
  "unmapped": { "spec": [ ... ], "code": [ ... ] }
}
```

| Field | Meaning |
| ----- | ------- |
| `spec` | Filename of the `.allium` file this map covers. |
| `language` | Target language of the implementation (e.g. `python`, `typescript`). Multiple adapters active means this is an array. |
| `commit` | Git SHA of the target project at build time. Used by `refresh` mode to detect stale entries. |
| `built_at` | ISO-8601 timestamp of the build. Informational. |
| `adapter_version` | Which language adapter and adapter version produced the map. Bump when an adapter's rules change materially. |
| `nodes` | Keyed by node ID. Every `spec:` or `code:` reference in `links` or `call_edges` resolves to a node. |
| `links` | Cross-side edges (spec vs. code). This is the primary thing other skills read. |
| `call_edges` | Same-side edges on the code graph (caller to callee). Used by `propagate` for state-machine action maps and by the "blast radius" query. |
| `unmapped` | Spec nodes with no confirmed code match, and code symbols with no confirming spec link. Load-bearing for `weed`. |

## Nodes

Every node has a stable string ID: `spec:<name>` or `code:<fqn>`. IDs are the only way other skills reference nodes; do not rely on array positions.

### Spec node

```json
"spec:Candidacy": {
  "kind": "entity",
  "file": "interview.allium",
  "line": 42
}
```

`kind` ∈ `entity`, `variant`, `value_type`, `enum`, `rule`, `trigger`, `surface`, `contract`, `invariant`, `config`, `default`, `actor`.

### Code node

```json
"code:interview.services.candidacy.create_candidacy": {
  "kind": "function",
  "file": "src/interview/services/candidacy.py",
  "line": 87,
  "fqn": "interview.services.candidacy.create_candidacy"
}
```

`kind` ∈ `function`, `method`, `class`, `module`, `decorator`, `constant`, `type_alias`. The set is language-agnostic; the adapter maps LSP symbol kinds onto it.

`fqn` is the fully-qualified name as LSP reports it, with the language's native separator (`.` in Python, `/` in Go with the package path, etc.). Use it for cross-file identification.

## Links

```json
{
  "from": "spec:Candidacy",
  "to": "code:interview.services.candidacy.create_candidacy",
  "via": "name-match+hover",
  "confidence": "high",
  "rejected_candidates": []
}
```

| Field | Meaning |
| ----- | ------- |
| `from` | A `spec:` node ID. |
| `to` | A `code:` node ID. |
| `via` | How the link was proven. Enumerated below. |
| `confidence` | `high`, `medium`, `low`. Per the adapter's confidence heuristic. |
| `rejected_candidates` | Other `code:` IDs that were plausible but lost the disambiguation. Empty when the match was unambiguous. |

### `via` values

- `name-match+hover` — workspaceSymbol hit plus hover/docstring confirmation. Strongest automatic signal.
- `name-match+single` — workspaceSymbol returned exactly one candidate; no secondary signal needed.
- `name-match+ambiguous` — multiple candidates survived; this link is one of several recorded at low confidence.
- `surface-decorator` — matched via framework entry-point pattern from the adapter (e.g. Flask route decorator).
- `docstring-ref` — code docstring explicitly references the spec construct by name.
- `manual` — hand-curated; the skill never writes this. Reserved for user annotation.

Other skills must treat links they don't recognise as opaque: skip them rather than erroring.

## Call edges

```json
{
  "caller": "code:...create_candidacy",
  "callee": "code:...persist",
  "cross_module": false
}
```

Only edges within the project root are recorded. `cross_module` is true when caller and callee live in different top-level packages — `propagate` uses this to identify integration-test candidates.

## Unmapped

```json
"unmapped": {
  "spec": [
    { "id": "spec:Rule.ReassignOnDecline", "reason": "no-workspace-symbol-match" }
  ],
  "code": [
    { "id": "code:interview.legacy.old_flow.handle", "reason": "no-link" }
  ]
}
```

`reason` is a short tag, not free-form prose. Values:

- `no-workspace-symbol-match` — the adapter generated variants, no LSP result.
- `low-confidence-only` — candidates existed but all fell below the adapter's confidence floor.
- `no-link` — code symbol found during traversal with no confirming link back to any spec node.
- `out-of-scope` — deliberately excluded by the adapter's exclusion rules (test files, migrations, etc.).

## Integration contract

This section is the compatibility promise between the `impact` skill and its consumers. Other skills read the JSON directly; the impact skill never renegotiates the schema without bumping `adapter_version`.

### Reading the map

Consumers MUST:

- Resolve every node reference through the `nodes` table. Do not parse IDs into fields.
- Treat unknown `via` values as opaque — record the link but do not rely on its provenance.
- Treat unknown `kind` values the same way. New kinds may appear as Allium evolves.
- Respect the `unmapped` section. A spec node in `unmapped.spec` has no implementation candidate; treat that as a finding, not a bug.
- Read the linked code. The map points consumers at code; it does not replace reading it. A `link` tells you *where* the implementation lives, not *whether the implementation satisfies the spec construct's clauses* — that's the consumer's job.

Consumers MUST NOT:

- Write to the map. Only the `impact` skill produces it.
- Invent links. If the map says a spec node is unmapped, the consumer does not silently "find" a match.
- Cross-reference maps from different specs. Each map is scoped to one `.allium` file.

### When to rebuild

The `impact` skill decides when a rebuild is needed. Consumers request a rebuild by invoking `impact` in `refresh` mode (cheap) or `build` mode (full). Typical triggers:

- Before running `weed` — refresh.
- Before running `propagate` — refresh.
- After a large refactor — build.
- When `weed` reports a surprising volume of divergences, suggesting the map is stale — refresh.

### Graceful degradation

The map is an optimisation, not a prerequisite. When the `impact` skill returns `degraded: true` (no language adapter matches the project, the required LSP plugin is missing, or the LSP is installed but not indexing), consumers MUST fall back to pre-map behaviour (`grep` + `read` correlation) rather than refusing the work. Consumers should:

- Note the degradation reason to the user once, not on every step.
- Proceed with manual correlation as they would have before the map existed.
- Not write a stub or partial JSON to `.allium/impact/` — only the `impact` skill produces map files, and it writes nothing when degraded.

### Versioning

`adapter_version` bumps when:

- A language adapter's name-variant or confidence rules change.
- A new `via` value is added.
- A new `kind` is added.

Consumers may log a warning if they see an `adapter_version` they don't recognise, but must still read the map. Forward compatibility is the goal.

## Worked example

Given this spec fragment:

```allium
-- interview.allium

entity Candidacy {
    status: pending | active | closed
}

rule ScheduleInterview {
    when: SchedulerTriggered(candidacy)
    requires: candidacy.status = active
    ensures: Interview.created(candidacy: candidacy, status: scheduled)
}

surface CandidateAPI {
    provides: ScheduleInterview
}
```

And this Python implementation:

```python
# src/interview/models.py
class Candidacy:
    status: str  # "pending" | "active" | "closed"

# src/interview/services/scheduler.py
def schedule_interview(candidacy: Candidacy) -> Interview:
    """Witnesses rule ScheduleInterview."""
    assert candidacy.status == "active"
    return Interview.create(candidacy=candidacy, status="scheduled")

# src/interview/api/routes.py
@router.post("/candidacies/{id}/interviews")
def create_interview(id: str):
    return schedule_interview(get_candidacy(id))
```

The produced map:

```json
{
  "spec": "interview.allium",
  "language": "python",
  "commit": "abc123",
  "built_at": "2026-04-20T10:00:00Z",
  "adapter_version": "python-v1",
  "nodes": {
    "spec:Candidacy":          { "kind": "entity",  "file": "interview.allium", "line": 3 },
    "spec:Rule.ScheduleInterview": { "kind": "rule", "file": "interview.allium", "line": 7 },
    "spec:Surface.CandidateAPI":   { "kind": "surface", "file": "interview.allium", "line": 13 },
    "code:interview.models.Candidacy": {
      "kind": "class", "file": "src/interview/models.py", "line": 2,
      "fqn": "interview.models.Candidacy"
    },
    "code:interview.services.scheduler.schedule_interview": {
      "kind": "function", "file": "src/interview/services/scheduler.py", "line": 2,
      "fqn": "interview.services.scheduler.schedule_interview"
    },
    "code:interview.api.routes.create_interview": {
      "kind": "function", "file": "src/interview/api/routes.py", "line": 2,
      "fqn": "interview.api.routes.create_interview"
    }
  },
  "links": [
    { "from": "spec:Candidacy", "to": "code:interview.models.Candidacy",
      "via": "name-match+single", "confidence": "high", "rejected_candidates": [] },
    { "from": "spec:Rule.ScheduleInterview",
      "to": "code:interview.services.scheduler.schedule_interview",
      "via": "docstring-ref", "confidence": "high", "rejected_candidates": [] },
    { "from": "spec:Surface.CandidateAPI",
      "to": "code:interview.api.routes.create_interview",
      "via": "surface-decorator", "confidence": "high", "rejected_candidates": [] }
  ],
  "call_edges": [
    { "caller": "code:interview.api.routes.create_interview",
      "callee": "code:interview.services.scheduler.schedule_interview",
      "cross_module": true }
  ],
  "unmapped": { "spec": [], "code": [] }
}
```

A `weed` run reads this map, sees every spec node linked and no unmapped code, and reports no structural divergences. It then reads the rule's `requires` (`status = active`) and compares to the code (`assert candidacy.status == "active"`) — that check is unchanged by the map, but the map got `weed` straight to the right file in one hop instead of greping.
