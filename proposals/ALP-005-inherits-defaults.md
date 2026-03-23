# ALP-5: `inherits defaults:` clause

**Status**: reject (problem addressed by ALP-10)

## Problem

Configuration surfaces need to distinguish between values the consumer must supply and values that have defaults defined elsewhere. There is no mechanism to reference default values from another module.

## Proposed construct

`inherits defaults:` as a surface clause, listing cross-module references to default values.

```allium
surface DomainConfiguration {
    requires:
        instance_id: String
        shard_count: Integer

    inherits defaults:
        core.required_copies
        core.max_batch_size
        core.publish_delay_increment
}
```

## Rationale

Configuration specs should make it clear which values are mandatory and which have defaults. `inherits defaults:` makes the relationship explicit and traceable: tooling can verify the referenced values exist and report when defaults change.

## Questions for the committee

1. What are the semantics? Does `inherits defaults` mean the values are optional in the consumer's configuration? That they're present with the referenced default unless overridden?
2. Is this distinct enough from `guidance:` to warrant its own clause? A guidance block saying "defaults are inherited from core" conveys the same information to a human reader, if not to tooling.
3. Should the referenced values be `config` declarations, `default` declarations, or any named value?

## Committee review

**Status: rejected.** The panel unanimously recommended against adoption. The construct has undefined semantics, demonstrates itself with invalid syntax and places the solution in the wrong part of the language.

### Key objections

- **Undefined semantics.** The proposal defers its three core design questions to the committee. Without answers to what `inherits defaults:` means at evaluation time, whether referenced values become optional, and whether they refer to `config` parameters or `default` entity instances, the construct has no evaluable behaviour. Multiple panellists noted that `config` parameters (typed values with defaults) and `default` declarations (named entity instances) are distinct language concepts that the keyword "defaults" conflates.
- **Wrong location.** Surfaces describe behavioural contracts at boundaries. Cross-module configuration assembly is a deployment concern that belongs in the `config` system. The existing cross-module config override syntax (`oauth/config { ... }`) already provides a mechanism for this. Six panellists identified this placement error independently.
- **Invalid example syntax.** The proposal uses `requires:` inside a surface, which is not a surface clause. Four panellists flagged this as evidence the proposal is reaching for concepts that do not yet exist in the language.
- **Existing mechanisms suffice.** `guidance:` blocks communicate cross-module default relationships to human readers. The `config` override system handles the mechanical side. No gap was identified that warrants new grammar.

### Resubmission guidance

If the underlying problem, making cross-module configuration defaults explicit and verifiable, is worth solving, a revised proposal should: (a) build on the existing `config` block syntax rather than introducing a surface clause, (b) resolve the ambiguity between `config` parameters and `default` declarations by choosing one referent, (c) define precise semantics for override precedence, and (d) demonstrate with examples using valid current syntax.
