# ALP-5: `inherits defaults:` clause

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
