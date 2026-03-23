# ALP-8: Destructuring binds in `for` loops

**Status**: reject (`.indexed` concern split to ALP-12)

## Problem

When iterating over indexed or paired collections, the current `for` syntax binds a single variable. Accessing the index and value requires separate expressions inside the loop body, which obscures the intent and adds noise.

## Proposed construct

Tuple destructuring in the `for` loop binding position.

```allium
for (index, payload) in state.consensus_record.output_payloads.indexed:
    KafkaPublishRequested(state.input_offset, index, payload)
```

## Rationale

The alternative is:

```allium
for item in state.consensus_record.output_payloads.indexed:
    let index = item.index
    let payload = item.value
    KafkaPublishRequested(state.input_offset, index, payload)
```

The destructured form says the same thing in one line instead of three. It also makes the loop's intent immediately visible: "for each index-payload pair". This is a small convenience, but `for` loops with indexed iteration are common enough that the noise adds up across a spec.

## Questions for the committee

1. Should destructuring be limited to pairs `(a, b)` or support arbitrary arity `(a, b, c, ...)`?
2. Should nested destructuring be supported (`for (index, (key, value)) in ...`)?
3. Does this imply a `.indexed` method on collections, or is the collection expected to contain tuples by construction?

---

## Committee review

**Summary.** One proposal debated. The panel converged on rejection of the destructuring syntax as proposed, with a constructive recommendation to split the underlying `.indexed` concern into a separate, smaller proposal. No panellist supported adopting both features as a bundle.

### ALP-8: Destructuring binds in `for` loops

**Proposal.** Introduce tuple destructuring in `for` loop bindings, allowing `for (index, payload) in collection.indexed:` instead of binding a single variable and accessing fields in the body. The motivation is reducing noise in indexed iteration.

**Key tensions.**

The panel identified a structural problem before reaching the syntax debate: neither `.indexed` nor tuple types exist in the current language. The proposal implicitly requires both, making it substantially larger than presented.

- **Simplicity vs expressiveness.** The simplicity advocate found the three-line form clear and sufficient; the creative advocate argued for going further to general record destructuring. Neither endorsed the middle ground of pair-only tuples.

- **Composability vs novelty.** The composability advocate, machine reasoning advocate and rigour advocate converged on an alternative: specify `.indexed` as returning a named value type (e.g. `IndexedItem` with fields `index: Integer` and `value: T`), then use the existing `item.index` / `item.value` access pattern. This requires no new grammar and composes with every existing construct.

- **Domain modelling.** The domain modelling advocate questioned whether positional indexing belongs in iteration syntax at all, suggesting the offset should be modelled as a field on the payload entity. The simplicity advocate and creative advocate pushed back, arguing that positional ordering is a legitimate domain concept when sequence matters. This tension was not fully resolved but did not affect the verdict.

- **Bundling concern.** The rigour advocate, developer experience advocate and backward compatibility advocate all objected to evaluating two undefined features as a single proposal. The backward compatibility advocate explicitly recommended deferring rather than rejecting, pending a standalone `.indexed` specification.

**Resolved concerns.** The readability advocate's concern about frequency was confirmed: zero uses of `.indexed` appear in the patterns library. The composability advocate's named-record alternative was endorsed by the machine reasoning advocate and rigour advocate as the right decomposition. The backward compatibility advocate confirmed zero installed-base cost, removing migration as a concern.

**Remaining concerns.** Whether positional indexing is a domain concept or implementation leakage (domain modelling advocate vs simplicity advocate). Whether a general destructuring form would eventually be needed even if `.indexed` returns named records (creative advocate, unresolved).

**Verdict: reject.**

The destructuring syntax does not clear the bar. The proposal bundles two undefined primitives (`.indexed` and tuple destructuring) and the panel found that the simpler path — specifying `.indexed` as a named value type and using existing field access — achieves the same goal without new grammar.

The committee recommends:

1. **Split `.indexed` into a standalone proposal** specifying it as a collection method returning a named value type with `index` and `value` fields. This is a well-scoped addition that composes with existing syntax.
2. **Revisit destructuring only if** usage of `.indexed` (or similar constructs) reveals that the `let` binding pattern creates recurring friction that justifies new grammar.
3. **Do not pursue tuple types** as a language primitive. Allium's type system is built on named fields; anonymous positional types are inconsistent with that design.

### Deferred items

- `.indexed` collection method — recommended for a separate proposal (see recommendation 1 above).
- General record destructuring — raised by the creative advocate as a potential future feature. No consensus on whether it is needed. Deferred to the language author.
