# Integrating slices (the reduce step)

When a large goal is fanned out — one `distill` (or one loop) per service or domain — each slice converges on its own. But slices distilled in isolation don't automatically agree at their **seams**: the same entity may be defined twice, a rule in one slice may depend on a trigger another slice was supposed to emit, a contract may be demanded with nothing to fulfil it. Fan-out is the *map*; this is the *reduce* — assemble the slices into one spec and drive the seams *between* them to convergence.

This reference is the seam detail for [driving the loop](./driving-the-loop.md) §6. The orchestrator drives it with the CLI doing the cross-checking and the existing phase agents doing the edits, so no slice's full text is ever read into the orchestrator's own context.

## Why the CLI does the seeing

`allium analyse` and `allium check` take **multiple files or a whole directory** and reason across them: they resolve qualified references and `use` imports, match `demands` against `fulfils`, and — as of the cross-module analysis release — trace data flow, reachability and witnessing *across* `use` boundaries. So the cross-check is one CLI call over the whole slice set that returns a small JSON findings list, not a model reading every slice. The orchestrator runs the call and routes on the result; the reading stays in the CLI.

One prerequisite: the slices must be **wired** first. Un-wired, they are separate islands to the checker — `analyse` can only cross a seam it can see through a `use` edge and qualified names. Assembly (below) is what makes the set one connected graph for `analyse` to reason over.

## The procedure

### 1. Assemble and wire

Establish the shared vocabulary and connect the slices.

- **Shared entities: pick one canonical owner.** When two slices each distilled the same entity (`User`, `Order`, `Account`), one slice owns the declaration and the others `use`-import it. Choose the owner by where the entity's lifecycle lives — the slice that creates it and drives its status transitions. Use `allium model <slice>` (JSON: entity shapes, fields, state machines) to compare the two declarations cheaply without reading the full specs. If they disagree on fields or states, that disagreement is itself a seam to reconcile (via `tend`), not a free merge.
- **Wire the references.** Add `use "./owner.allium" as <alias>` to each consuming slice and rewrite its references to the shared entity as qualified names (`orders/Order`). Config that derives from another slice's config uses the qualified reference or an expression-form default.
- **Order by the data-flow graph.** Wire producers before consumers, following the trigger-emission graph, so the assembled set reads in dependency order.

### 2. Cross-check with the CLI

Run `allium analyse` over **all the assembled slices at once** (pass the directory or every file). Read both arrays it returns:

- **`findings`** — the process-level seam problems (`missing_producer`, `dead_transition`, `deadlock`, `conflict`, `unreachable_trigger`, `invariant_risk`). Across a seam these mean one slice depends on behaviour another slice doesn't provide.
- **`diagnostics`** — structural seam problems. The clearest broken-seam signal is **`allium.reference.unknownName`** (a slice references a qualified name the owning slice doesn't declare or emit) and unresolved `use` paths. Do not skip the diagnostics array: a broken seam often shows up there first, as a dangling reference on the consumer *plus* a deadlock on the producer whose exit that consumer was meant to witness.

### 3. Route each seam problem

Translate each finding or seam diagnostic into an action, the same way [actioning findings](./actioning-findings.md) prescribes — the finding taxonomy applies unchanged across a seam:

- **Dangling reference / `missing_producer` / `unreachable_trigger` across the seam** — the consumer needs something no slice provides. Decide which slice should provide it and `tend` that slice to emit the trigger or expose the surface; or, if the producer exists but wasn't wired, fix the wiring (step 1).
- **`dead_transition` / `deadlock` at the seam** — an entity's exit is witnessed only in another slice that isn't correctly wired. Usually a wiring fix, occasionally a genuine gap to `tend`.
- **`conflict` across slices** — two slices' rules can set the same field in the same state. This is a direction-changing question: escalate it (§5), don't silently pick an order.
- **Shared-entity disagreement** — the canonical and imported field/state sets differ. `tend` the non-canonical slices to the canonical shape, or escalate if the difference is a real domain disagreement.

Delegate each edit to `tend` (or `weed` when it's a spec↔code reconciliation), never reconcile by reading the slices into the orchestrator. Re-run `analyse` after the edits; iterate until the seam findings are gone, under the loop's normal caps (§4).

### 4. Cross-service tests

Once the seams are clean, `propagate` over the assembled set. Its taxonomy already covers the cross-slice cases — cross-module trigger chains, cross-entity process tests, data-flow-chain tests from a surface in one slice through to a downstream `requires` in another. These are the tests that exercise the seams the per-slice loops could not.

### 5. Witness the whole

Run a final `witness` (§11) over the assembled spec, so the integrated whole carries the same convergence guarantee each slice did. Only then is the large goal converged.

## What stays out of the orchestrator

The orchestrator holds the slice paths, the CLI's JSON findings, and the ledger — never the slice bodies. Assembly decisions use `allium model` (JSON); the cross-check uses `allium analyse` (JSON); the edits are delegated to `tend`/`weed` in their own contexts. This is the same isolation the fan-out uses for the map, applied to the reduce.
