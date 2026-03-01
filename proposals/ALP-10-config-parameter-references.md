# ALP-10: Cross-module config parameter references

## Problem

When a module composes several imported modules, its configuration surface is split across multiple config blocks. A reader must inspect each imported module's config to understand which parameters have defaults and which must be supplied. There is no way to declare that a local config parameter inherits its default from an imported module's config, making the dependency invisible.

The ALP-5 panel identified this as a real problem but rejected `inherits defaults:` as a surface clause because configuration assembly belongs in the `config` system, not in surfaces. This proposal follows the panel's resubmission guidance: build on existing `config` block syntax, resolve the `config`/`default` ambiguity, define override precedence and use valid current syntax throughout.

## Proposed construct

Allow config parameter default values to reference other config parameters via qualified names.

```allium
use "./core.allium" as core

config {
    instance_id: String                                     -- mandatory, no default
    shard_count: Integer                                    -- mandatory, no default
    required_copies: Integer = core/config.required_copies  -- defaults to core's value
    max_batch_size: Integer = core/config.max_batch_size    -- defaults to core's value
    publish_delay: Duration = core/config.publish_delay     -- defaults to core's value
}
```

A config parameter whose default is a qualified reference resolves to the referenced parameter's current value. The local parameter can still be overridden by any consuming module using the standard override syntax.

## Semantics

### Resolution order

1. If the consuming module sets the parameter explicitly, that value wins.
2. Otherwise, the qualified reference is followed. If the referenced parameter was itself overridden by the consuming module, the overridden value is used.
3. Otherwise, the referenced parameter's own default value is used.

This is single-level indirection. A reference to `core/config.max_batch_size` resolves to whatever value `max_batch_size` holds in `core`'s config after all overrides have been applied. Chains of references (`A` defaults to `B`, `B` defaults to `C`) resolve transitively, but the checker warns on chains longer than two to discourage deep indirection.

### Example

```allium
-- core.allium
config {
    max_batch_size: Integer = 100
}
```

```allium
-- domain.allium
use "./core.allium" as core

config {
    max_batch_size: Integer = core/config.max_batch_size  -- defaults to 100
}
```

```allium
-- app.allium
use "./domain.allium" as domain

domain/config {
    max_batch_size: 250  -- overrides domain's value, which also overrides core's
}
```

In `app.allium`, `domain/config.max_batch_size` resolves to 250. If the override were removed, it would resolve to 100 (core's default, flowing through domain's reference).

### What this does not do

- It does not create a new clause or keyword. The syntax extends config parameter defaults to accept qualified references alongside literal values.
- It does not conflate `config` and `default`. This proposal scopes exclusively to `config` parameters. `default` declarations (named entity instances) are a separate concern and are not referenceable as config defaults.
- It does not affect surfaces. Surfaces continue to use `exposes`, `provides`, `expects`, `offers` and `guidance` for their contracts. Configuration assembly stays in `config` blocks.

## Interaction with existing constructs

### Config override blocks

The existing `oauth/config { ... }` override syntax is unaffected. A consuming module may override a parameter that has a qualified reference default, and the override takes precedence per the resolution order above.

### Rules referencing config

Rules continue to use `config.field` for local parameters. The qualified reference in the default is resolved before any rule evaluates; rules see the final resolved value.

### Validation rule 25

Validation rule 25 requires config parameters to have explicit types and default values. This proposal relaxes it: a config parameter with a qualified reference default satisfies rule 25 because the type and default are both derivable from the referenced parameter. The checker should verify that the declared type matches the referenced parameter's type.

## Validation rules to add

48. A qualified config reference in a default expression must resolve to a declared parameter in an imported module's config block
49. The declared type of a parameter with a qualified default must match the referenced parameter's type
50. The checker warns on config reference chains longer than two levels of indirection

## Error catalogue

### E6: Unresolved config reference

**Trigger**: A config default references `alias/config.param` where `param` is not declared in the referenced module's config block.

**Diagnostic**: "Config parameter 'param' not found in module 'alias'. Check that the parameter name matches and the module is imported via `use`."

### E7: Type mismatch in config reference

**Trigger**: A config parameter is declared as `Duration` but references a parameter of type `Integer`.

**Diagnostic**: "Type mismatch: 'max_retries' is Integer in module 'core', but declared as Duration here."

### W1: Deep config reference chain

**Trigger**: A config reference chain exceeds two levels of indirection.

**Diagnostic**: "Config parameter 'field' resolves through 3 levels of indirection. Consider referencing the source parameter directly."

## Expression-form defaults

Config defaults may also be expressions that combine qualified references with arithmetic. This allows derived configuration values that maintain a traceable relationship to their source.

```allium
config {
    base_timeout: Duration = core/config.base_timeout       -- bare reference
    extended_timeout: Duration = core/config.base_timeout * 2  -- expression
    buffer_size: Integer = core/config.batch_size + 10         -- expression
}
```

Expression-form defaults use the same arithmetic operators available in the existing expression language: `+`, `-`, `*`, `/`. Standard precedence applies. Both operands must resolve to compatible types; the checker verifies type consistency.

### Resolution

Expression-form defaults resolve in the same order as bare references: explicit override wins, then the expression is evaluated using the resolved values of any referenced parameters. The expression is evaluated once at config resolution time, not re-evaluated dynamically.

### Motivation

The roadmap review panel identified this as beneficial for PBT generation (TODO.md item 2). A PBT generator deriving entity generators bounded by config values can follow an expression-form default to understand the relationship between parameters, producing tighter test bounds than treating each parameter independently.

### Validation

Expression-form defaults are subject to the same validation rules as bare references (rules 48-49). The checker additionally verifies:

51. Expression-form config defaults must use only arithmetic operators (`+`, `-`, `*`, `/`) and literal values alongside qualified config references
52. Both sides of an arithmetic operator in a config default must resolve to type-compatible operands

### Error catalogue addition

#### E8: Invalid config default expression

**Trigger**: A config default expression uses an operator or construct beyond arithmetic and qualified references.

**Diagnostic**: "Config default expressions support arithmetic operators and qualified config references only. 'slots.count' is not a valid config default expression."

## Questions for the committee

1. Should the checker enforce that the local parameter name matches the referenced parameter name, or is renaming permitted? Renaming allows domain-appropriate vocabulary (`publish_delay` referencing `core/config.default_delay`) but makes tracing harder.
2. Is the two-level indirection warning the right threshold, or should chained references be prohibited entirely?
3. Should expression-form defaults support boolean expressions (e.g. `enabled: Boolean = core/config.feature_flag and env/config.is_production`), or should they be restricted to arithmetic?
