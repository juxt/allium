# ALP-3: `trait` declarations

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
