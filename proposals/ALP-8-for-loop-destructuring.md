# ALP-8: Destructuring binds in `for` loops

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
