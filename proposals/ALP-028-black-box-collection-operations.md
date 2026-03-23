# ALP-028: Black-box functions are indistinguishable from built-in collection operations

**Status**: adopt
**Constructs affected**: collection operations, black box functions
**Sections affected**: Collection operations, Black box functions

## Problem

A reader cannot determine whether a dot-method call on a collection is a built-in language operation or a black-box function. Both use identical syntax.

```
-- Built-in
group.events.count
group.events.any(e => e.offset > 10)

-- Black-box (but looks identical to built-in)
cycle.groups.flatMap(g => g.deferred_events)
state.received_copies.grouped_by(r => r.output_payloads)
cycle.still_pending.min_by(e => e.offset)
```

The checker does not validate method names on collections. `collection.totallyMadeUpMethod(x => x)` passes without warning. This means:

1. A spec author can introduce an undefined operation without feedback.
2. A reader must memorise the built-in set to know whether a dot-method is part of the language or a domain-specific function that the implementation must provide.
3. A black-box function cannot share a name with a built-in. If `filter` were added as a built-in, every spec using `filter` as a black-box function would silently change meaning.
4. Test generation tooling cannot distinguish "the language guarantees these semantics" from "the implementation must provide this" without hardcoding the built-in list.

## Evidence

During a V3 upgrade of the Achronic specifications (10 spec files, ~3,500 lines), the following dot-method calls were used on collections but are not documented in the language reference's collection operations section: `flatMap`, `grouped_by`, `filter`, `max_by`, `min_by`, `indexed`, `map`, `distinct`, `.min`, `.values`, `.keys`. All passed the checker. Five parallel review agents failed to flag them as non-standard. The discrepancy was only identified during a post-hoc analysis of V3 feature coverage.

The language reference documents these built-in collection operations: `.count`, `.any()`, `.all()`, `.first`, `.last`, `.unique`, `.add()`, `.remove()`, `where`, `in`, `not in`, `+`, `-`, `for`. The undocumented operations outnumber the documented ones.

Free-standing black-box functions (`hash(password)`, `verify(password, hash)`) are visually distinct from built-in operations because they do not chain off a collection with dot syntax. Collection-operating black-box functions have no equivalent visual distinction.

## Design tensions

**Dot syntax is ergonomic for chaining.** Collection pipelines read naturally left-to-right with dot methods: `events.filter(predicate).flatMap(fn).count`. Moving black-box operations to a different syntax breaks this flow.

**The built-in set is meant to be small.** The language's design principle is to keep the built-in operation set minimal. Expanding it to include `flatMap`, `filter`, `map` etc. would make the language more expressive but increase the surface area that the checker, test generator and documentation must cover.

**Black-box functions are already defined by their call site.** The language has an existing convention: free-standing function calls (`hash(password)`) are black-box. Dot-method calls (`.count`, `.any()`) are built-in. But this convention is not stated anywhere, and the checker does not enforce it.

**Name collision risk is real but infrequent.** The built-in set has changed three times across 27 ALPs. Each change could silently alter the meaning of a black-box function that happens to share the new built-in's name, with no checker warning.

## Scope

This ALP is about the syntactic ambiguity between built-in and black-box operations on collections. It is not about expanding the built-in collection operation set, changing the checker's type system, or introducing new collection types. Ordered collection semantics (ALP-025) are a separate concern; this ambiguity exists regardless of whether collections are ordered.

## Panel review (round 1)

**Status**: refine
**Date**: 2026-03-23

### Summary

One item debated. The panel agreed unanimously that the problem is real and evidenced but reached a verdict of **refine**: the ALP identifies the problem without proposing a specific solution, and the design space contains approaches with materially different trade-offs.

### Responses

**Simplicity advocate.** Two distinct issues are tangled together. First, the checker does not validate method names, which is a tooling gap. Second, the syntax is ambiguous between built-in and black-box, which is a language design gap. Fixing the first does not require fixing the second. A checker that rejects unknown dot-methods would eliminate the silent-introduction problem without any syntax change.

**Machine reasoning advocate.** This is a significant problem for automated tooling. When encountering `collection.flatMap(fn)`, a model cannot determine from syntax alone whether this has language-defined semantics or implementation-defined semantics it must treat as opaque. The five review agents that failed to flag these operations are direct evidence of the cost.

**Composability advocate.** The current design has an implicit convention (dot-methods are built-in, free-standing functions are black-box) that is neither stated nor enforced. Implicit conventions are exactly the kind of context-dependent meaning to distrust. That said, any solution must compose with the existing expression language. Dot syntax chains naturally; wrapping black-box collection operations in a different syntax could break the algebraic structure of collection pipelines.

**Readability advocate.** For a product owner reading a spec, `events.filter(e => e.recent)` and `events.any(e => e.recent)` look the same. Both read naturally. The distinction between "the language guarantees this" and "the implementation must provide this" is invisible and irrelevant to a domain reader. If the fix adds visual noise to collection pipelines, that is a cost to readability with no corresponding benefit for that audience.

**Rigour advocate.** The name collision risk is a genuine semantic hazard. If the language adds `filter` as a built-in and existing specs use `filter` as a black-box function with different semantics, those specs silently change meaning. The checker's failure to validate dot-methods also means no feedback on typos: `collection.cont` instead of `collection.count` passes without warning.

**Domain modelling advocate.** Domain operations on collections are natural. "Give me the events grouped by output" is a domain concept, and `events.grouped_by(e => e.output)` reads as domain language. Forcing these into a syntactically distinct form risks pushing domain vocabulary out of the spec's natural reading order.

**Developer experience advocate.** The day-one test is failing. A new spec author writes `collection.filter(predicate)` because it looks like every other collection operation, the checker accepts it, and nobody tells them it is not a built-in. They discover the distinction only when test generation treats it as opaque. Whatever solution the language adopts, the critical path is: the checker must give feedback when a dot-method is not in the built-in set.

**Creative advocate.** Should the built-in collection operation set be larger? The fact that eleven undocumented operations appeared in real specs suggests the current built-in set is too small for practical use. `filter`, `map` and `flatMap` are so universal that treating them as black-box functions feels like an arbitrary omission.

**Backward compatibility advocate.** Whatever direction this takes, the migration path matters. There are existing specs using `flatMap`, `grouped_by`, `filter` and the rest as if they were built-in. The Achronic specs alone have at least eleven such operations.

### Rebuttals

**Simplicity to creative:** Expanding the built-in set is a separate proposal with its own costs. This ALP scoped itself to the ambiguity problem, and that scoping is correct.

**Machine reasoning to readability:** The distinction is irrelevant to domain readers, agreed. But it is critical for every other consumer: the checker, the test generator, review agents and developers implementing the system. A subtle signal that automated tooling can detect would resolve the problem without degrading readability.

**Rigour to developer experience:** Checker validation alone is necessary but may not be sufficient. The name collision problem requires either a syntactic distinction or a reservation mechanism that prevents future built-ins from colliding with existing black-box names.

**Composability to domain modelling:** The current situation is worse than either alternative. `grouped_by` looks like a built-in but is not. A reader who trusts the built-in interpretation is misled. Making the distinction explicit, even if it changes the surface form, would make the spec more honest about what it promises.

**Creative to simplicity:** The panel should note that expanding the built-in set is one of the plausible design-space options. If the most-used "black-box" operations become built-ins, the ambiguity surface shrinks substantially.

**Developer experience to backward compatibility:** The current state is that specs are silently wrong. Every day without checker feedback is a day someone writes `collection.madeUpMethod()` and does not know it. The migration cost is real but bounded; the ongoing cost of not enforcing is unbounded.

**Domain modelling to composability:** The fix must not push domain language into an unnatural form. `collection |> grouped_by(e => e.output)` or `apply grouped_by(collection, e => e.output)` reads like programming, not domain specification. The form matters.

### Synthesis

The panel agreed unanimously that the problem is real, recurring and evidenced. No panellist argued for maintaining the status quo. Core agreements:

1. The checker must validate dot-method names on collections.
2. The name collision risk is a genuine semantic hazard.
3. Any syntactic solution must not degrade the natural reading of collection pipelines for domain stakeholders.

Unresolved tensions:

- Whether a syntactic distinction is needed or whether checker enforcement alone suffices.
- Whether expanding the built-in set is in scope.
- What form a syntactic distinction would take if adopted.

The design space includes at least: checker-only enforcement, explicit annotation or sigil, expanding the built-in set, and a registration syntax for black-box collection operations.

### Verdict: refine

The problem clears the bar for action. The panel recommends the language author select one or more design-space approaches and return with a concrete proposal specifying before-and-after syntax, checker behaviour and migration path.

---

## Panel review (round 2)

**Status**: adopt
**Date**: 2026-03-23

### Summary

Three concrete approaches debated. The panel reached **consensus: adopt** on Approach A (free-standing function syntax for black-box collection operations), the language author's preferred direction.

### Approaches evaluated

**Approach A: Free-standing function syntax.** Black-box operations that take a collection become free-standing function calls with the collection as the first argument. Dot-method syntax is reserved exclusively for built-in operations. The checker rejects any dot-method name not in the built-in set.

Before (ambiguous):
```
cycle.groups.flatMap(g => g.deferred_events)
state.received_copies.grouped_by(r => r.output_payloads)
cycle.still_pending.min_by(e => e.offset)
events.filter(e => e.recent)
events.filter(e => e.recent).count
```

After:
```
flatMap(cycle.groups, g => g.deferred_events)
grouped_by(state.received_copies, r => r.output_payloads)
min_by(cycle.still_pending, e => e.offset)
filter(events, e => e.recent)
filter(events, e => e.recent).count
```

Multi-step pipelines nest rather than chain:
```
-- Before
events.filter(e => e.recent).flatMap(e => e.details).count

-- After
flatMap(filter(events, e => e.recent), e => e.details).count
```

Built-in operations still chain from the result of a free-standing call, since the result is a collection.

**Approach B: Sigil-prefixed dot syntax.** A prefix sigil (`~`) on dot-method names marks them as black-box: `collection.~flatMap(fn)`. Preserves left-to-right chaining. The checker allows prefixed methods and rejects unprefixed unknown methods.

**Approach C: Expand the built-in set.** Promote `filter`, `map`, `flatMap`, `min_by`, `max_by`, `grouped_by` to built-in status with defined semantics. Reduces the problem but does not eliminate it for remaining novel operations.

### Responses

**Simplicity advocate.** Approach A is the cleanest. It draws a hard line: dot-methods are language, free-standing calls are domain. One rule, no exceptions, no new syntax. Approach B introduces a sigil that exists solely to mark a boundary the language should be enforcing structurally. Approach C bloats the built-in set and still leaves the residual problem unsolved.

**Machine reasoning advocate.** Approach A produces the most parseable grammar. A model encountering `flatMap(collection, fn)` can classify it as black-box without consulting a lookup table. Approach B introduces a new lexical token with context-dependent meaning, increasing surprisal. Approach C is worst for machine reasoning: the model must memorise a larger built-in set, and the boundary remains implicit for anything not promoted.

**Composability advocate.** Approach A concerns me on nesting depth. `flatMap(filter(events, e => e.recent), e => e.details).count` composes correctly but does not compose readably when three or four operations are chained. Approach B preserves composability by keeping chaining syntax, and the sigil is orthogonal to operation semantics. Approach C composes well syntactically but creates maintenance pressure: every new common operation pushes the language to expand the built-in set.

**Readability advocate.** Approach A degrades readability for nested pipelines. A domain stakeholder reading `flatMap(filter(events, e => e.recent), e => e.details)` must parse inside-out. For single operations the free-standing form reads tolerably, but pipelines of two or more become opaque. Approach B preserves left-to-right reading at the cost of a small visual mark. Approach C is the most readable: nothing changes for existing specs.

**Rigour advocate.** All three approaches solve the primary problem. The question is which leaves the fewest semantic gaps. Approach A is the most complete: the partition is total and enforced by syntax. Approach B relies on authors remembering the sigil. Approach C is incomplete by design and must be paired with A or B for the residual case.

**Domain modelling advocate.** The distinction between "the language knows what this does" and "the implementation must provide this" is meaningful. Approach A makes that distinction visible at every call site. Approach B makes it visible too, but the `~` sigil has no domain meaning and reads as a technical annotation. Approach C blurs the distinction.

**Developer experience advocate.** Day-one test: a new author writes `events.filter(e => e.recent)`. Under Approach A, the checker says "unknown method 'filter'; black-box functions use free-standing syntax: `filter(events, e => e.recent)`". That is a good error message and teaches the convention. Under Approach B, the checker says "prefix with ~ for black-box methods". Learnable, but the sigil feels like incidental complexity. I lean towards A for error-message quality.

**Creative advocate.** All three approaches are incremental. The real question is whether Allium's built-in set is too small. But that is a larger conversation. Within this ALP's scope, Approach A is the most principled. It also opens a path for a future pipeline operator if nesting becomes painful, without committing to one now.

**Backward compatibility advocate.** Approach A requires rewriting every use of `collection.flatMap(fn)` to `flatMap(collection, fn)`. In the Achronic specs that is 11+ call sites. The rewrite is mechanical: a tool can do it. Approach B requires inserting `~` before each method name, also mechanical. Approach C requires zero changes. All three are reversible.

### Rebuttals

**Composability to simplicity:** The nesting concern is not dismissed easily. `flatMap(grouped_by(filter(events, e => e.recent), e => e.category), g => g.items)` is a real expression shape. The simplicity of the rule does not guarantee the simplicity of the result.

**Simplicity to composability:** The anti-patterns section already discourages algorithm-level pipelines in specs. If a spec has three nested black-box operations, the right response is to extract a named derived value or deferred specification. The nesting discomfort is a feature: it pushes complexity to where it belongs.

**Readability to simplicity:** The anti-pattern applies to implementation-level algorithms, but `filter` and `grouped_by` are domain-level operations. Penalising their expression to preserve a syntactic rule seems backwards.

**Simplicity to readability:** If `grouped_by` is genuinely a domain operation that recurs across specs, it should be a built-in with defined semantics, not a black-box. The free-standing syntax correctly marks operations whose semantics the language does not guarantee. If the semantics should be guaranteed, that is Approach C's argument and belongs in a separate ALP.

**Machine reasoning to creative:** Bundling the built-in expansion question with this ALP repeats the mistake of earlier ALPs that tried to solve two problems at once. Solve the ambiguity first, expand second.

**Creative to machine reasoning:** Agreed on sequencing. But Approach A makes expansion easier than B does. Under A, promoting `filter` to built-in means it gains dot syntax automatically. Under B, promoting means removing the `~` prefix from existing call sites. A is the better foundation.

**Rigour to backward compatibility:** Under Approach A, the checker can provide automated fix suggestions. The migration is not "find and rewrite"; it is "run the checker, accept the suggested fixes". Near-zero cost in practice.

**Developer experience to readability:** The nesting concern is real for long pipelines but may be overstated. The Achronic evidence shows individual operations, not deep chains. Single-operation free-standing calls read fine.

**Domain modelling to readability:** A domain stakeholder does not need to read `flatMap(grouped_by(filter(...)))`. That expression should be a named derived value. The stakeholder reads the name. The syntactic form of the underlying expression matters less than whether the spec author was forced to name the concept.

### Synthesis

The panel converged substantially towards Approach A.

**Resolved concerns.** The nesting problem was acknowledged as real but reframed: deep nesting of black-box operations is rare in practice, and when it occurs it signals that the expression should be extracted into a named derived value or deferred specification. The simplicity advocate's point that nesting discomfort is useful pressure was endorsed by the domain modelling advocate. The backward compatibility concern was resolved once automated checker fix suggestions were confirmed as part of the migration path.

**Withdrawn.** The backward compatibility advocate's hesitation was addressed by the tooling path. The readability advocate's nesting concern stands for deep pipelines but is accepted as a tolerable trade-off given the rarity of multi-operation black-box chains in actual specs.

**Remaining.** The composability advocate notes that Approach A makes future pipeline syntax harder to retrofit if needed, but accepts this as speculative. The readability advocate records a mild reservation: `filter(events, e => e.recent)` is slightly less natural than `events.filter(e => e.recent)`, though not enough to outweigh the benefits.

**Approach B** received no strong advocate after rebuttals. The sigil adds a syntactic concept without sufficient payoff and reads as technical annotation rather than domain language.

**Approach C** was recognised as incomplete. It reduces the problem but does not eliminate it. The panel agreed it belongs in a separate ALP about expanding the built-in collection operation set.

### Verdict: consensus adopt (Approach A)

Black-box operations that take a collection use free-standing function syntax with the collection as the first argument. Dot-method syntax is reserved for built-in operations. The checker rejects unknown dot-method names on collections.

**Rationale:**

1. The partition is total and enforced by syntax. No lookup table, no sigil, no ambiguity.
2. Formalises an existing implicit convention: free-standing calls are already black-box for non-collection operations.
3. Migration is mechanical and automatable.
4. Clean foundation for future expansion: promoting a black-box operation to built-in means it gains dot syntax, with no other syntax changes needed.
5. The nesting cost for multi-operation pipelines is accepted as useful pressure to extract named derived values, consistent with existing anti-pattern guidance.

**Reservations recorded.** The readability advocate notes a mild readability regression for single free-standing calls compared to dot syntax. The composability advocate notes the approach slightly favours extraction over inline expression. Neither reservation blocks consensus.

**What changes:**

1. Dot-method syntax on collections is reserved for built-in operations: `count`, `any`, `all`, `first`, `last`, `unique`, `add`, `remove`.
2. Any dot-method call on a collection whose name is not in the built-in set is a hard error.
3. Black-box functions operating on collections use free-standing syntax with the collection as the first argument: `filter(events, predicate)` not `events.filter(predicate)`.
4. Built-in operations chain from the result of free-standing calls: `filter(events, predicate).count` is valid.
5. Error messages suggest the free-standing form: "Unknown collection method 'filter'. Black-box functions use free-standing syntax: `filter(collection, predicate)`."

**Files to update:** `references/language-reference.md` (collection operations section, black box functions section, anti-patterns guidance), glossary entry for Black Box Function.

### Deferred items

1. **Expanding the built-in collection operation set.** `filter`, `map`, `flatMap`, `min_by`, `max_by` and `grouped_by` recur across specifications and may warrant promotion to built-in status. This is a separate ALP. Approach A provides the right foundation: any operation promoted to built-in gains dot syntax automatically.
2. **Pipeline operator.** If nested free-standing calls create recurring friction despite the "extract a derived value" guidance, a pipeline operator could be considered in a future ALP. Approach A does not preclude it.
3. **Relationship between `filter` and `where`.** If `filter` is ever promoted to built-in, its semantics relative to `where` must be specified. `where` operates in projection and iteration contexts; `filter` with a lambda operates in expression contexts.
