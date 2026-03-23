# ALP-3: `trait` declarations

**Status**: reject (superseded by ALP-9/ALP-15 contracts)

## Problem

Some types define capabilities (operations another party implements) rather than data shape. The spec needs `Codec<T>` as an interface with `serialize` and `deserialize` operations, distinct from a `value` that describes a data structure.

## Proposed construct

`trait Name<T> { ... }` as a top-level declaration kind, containing operation signatures.

```allium
trait Codec<T> {
    serialize: (value: T) -> ByteArray
    deserialize: (bytes: ByteArray) -> T
}
```

## Rationale

The distinction between "data that exists" (value/entity) and "capability that must be implemented" (trait) carries meaning for specification readers and for any tooling that generates test stubs or validates implementations. Folding traits into `value` works syntactically but loses the signal that this type represents an obligation rather than a structure.

## Questions for the committee

1. Is the distinction between data types and capability types worth a new keyword, or can `value` absorb this role with a convention (e.g. abstract fields)?
2. Should traits support inheritance or composition (`trait Codec<T> extends Serializable`)?
3. Does this interact with ALP-1's obligation blocks? A `requires` block could reference a trait rather than inlining operation signatures.

## Committee review

**Status: rejected.** The panel agreed unanimously that the underlying need is real but the proposed solution is worse than the status quo.

### Key objections

- **Duplicates existing machinery.** `trait` bodies are syntactically identical to obligation block bodies. Two constructs with the same interior syntax but different scoping and referencing rules is the pattern most likely to confuse both LLMs and human readers.
- **Underspecified interactions.** The proposal did not define the relationship between traits and obligation blocks: whether `expects` blocks can reference traits, whether traits carry invariants, or how trait inheritance would work without subtyping rules Allium does not have.
- **Wrong vocabulary for the audience.** `trait` imports programming-language terminology without domain-modelling benefit. A `Codec` is an infrastructure concern, not a domain concept. Obligation blocks already communicate capability contracts in terms non-technical readers understand.
- **Dangerous design trajectory.** The `trait` keyword creates pressure toward trait inheritance, trait bounds and trait implementation declarations, each requiring subtyping machinery Allium has deliberately avoided.

### Alternative the panel converged on

Make obligation blocks declarable at module level and referenceable by name from `expects`/`offers` clauses. This delivers the reusability the proposal seeks without a new declaration kind, without a new keyword, and without opening a subtyping trajectory.

### Resubmission guidance

A revised proposal should abandon the `trait` keyword and instead propose module-level obligation block declarations with referencing syntax. It should specify: (a) the declaration syntax and keyword, (b) whether module-level obligation blocks can carry type parameters (noting ALP-2's rejection and its suggestion to scope type parameters to obligation blocks), (c) whether invariants and guidance blocks are permitted in the module-level form, and (d) how module-level declarations interact with surface-level `guarantee:` assertions.
