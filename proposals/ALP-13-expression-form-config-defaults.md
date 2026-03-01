# ALP-13: Expression-form config defaults

## Problem

ALP-10 introduced bare qualified references in config defaults (`param: Type = other/config.param`), allowing config parameters to alias values from imported modules. The ALP-10 panel adopted bare references but deferred expression-form defaults, which combine qualified references with arithmetic to express derived configuration values.

Without expression-form defaults, a module that needs a timeout twice as long as its dependency's base timeout must declare an unrelated literal value. The relationship between the two parameters is invisible to both readers and tooling. A PBT generator deriving entity generators bounded by config values cannot follow the relationship to produce tighter test bounds.

## Proposed construct

Allow config parameter defaults to be expressions that combine qualified config references, local config references and literal values with arithmetic operators.

```allium
use "./core.allium" as core

config {
    base_timeout: Duration = core/config.base_timeout          -- bare reference (ALP-10)
    extended_timeout: Duration = core/config.base_timeout * 2  -- expression-form
    buffer_size: Integer = core/config.batch_size + 10         -- expression-form
    retry_limit: Integer = max_attempts - 1                    -- local reference in expression
}
```

Expression-form defaults use arithmetic operators (`+`, `-`, `*`, `/`) with standard precedence. Both operands must resolve to type-compatible values.

## Semantics

### Resolution

Expression-form defaults resolve in the same order as bare references (ALP-10): explicit override wins, then the expression is evaluated using the resolved values of any referenced parameters. The expression is evaluated once at config resolution time, not re-evaluated dynamically.

### Local and qualified references

Both local config parameter references (`base_timeout * 2`) and qualified references (`core/config.base_timeout * 2`) are permitted in expressions. This avoids the irregularity the ALP-10 panel identified: if only qualified references were allowed in expressions, they would behave differently from local references, which is an unjustified asymmetry.

A local reference in an expression-form default creates a dependency between parameters within the same config block. The acyclicity rule (ALP-10 amendment 1) applies: the config reference graph, including both cross-module and local edges, must be a DAG.

## Open questions from ALP-10 deferral

The ALP-10 panel identified four questions that this proposal must address:

### 1. Type semantics

What does `Duration * 2` mean?

`Duration * Integer` produces a `Duration`. `Integer * Integer` produces an `Integer`. `Duration + Duration` produces a `Duration`. `Duration * Duration` is a type error. These rules match the existing expression language's type semantics for arithmetic in rule bodies and derived values.

The full type compatibility table for config default expressions:

| Left | Operator | Right | Result |
|------|----------|-------|--------|
| Integer | `+` `-` `*` `/` | Integer | Integer |
| Duration | `+` `-` | Duration | Duration |
| Duration | `*` `/` | Integer | Duration |
| Integer | `*` | Duration | Duration |

All other combinations are type errors.

### 2. Local references

Permitted. See "Local and qualified references" above.

### 3. Grammar impact

Config default position currently accepts: literal values (ALP-10: also qualified references). This proposal extends it to accept expressions. The parser must handle qualified references and local references in expression position within config blocks.

The grammar change is contained: the config default production becomes `default_value := literal | qualified_ref | expression`, where `expression` uses the same operator precedence as the existing expression language. The `/config.` infix in qualified references remains a unique structural signal that disambiguates qualified references from other identifiers.

### 4. Conceptual boundary

Config blocks with expression-form defaults are no longer purely declarative. They become a restricted computation layer: aliases (bare references) and derived values (expressions) over config parameters. This proposal accepts that shift as intentional. The restriction to arithmetic operators and config references prevents config blocks from becoming a general-purpose expression context. They remain a configuration assembly mechanism, not a rule evaluation context.

## Validation rules to add

51. Expression-form config defaults must use only arithmetic operators (`+`, `-`, `*`, `/`), literal values, local config parameter references and qualified config references
52. Both sides of an arithmetic operator in a config default must resolve to type-compatible operands per the type compatibility table above

## Error catalogue

### E8: Invalid config default expression

**Trigger**: A config default expression uses an operator or construct beyond arithmetic and config references.

**Diagnostic**: "Config default expressions support arithmetic operators and config references only. 'slots.count' is not a valid config default expression."

### E9: Type-incompatible config default expression

**Trigger**: An arithmetic operator is applied to operands whose types are not in the compatibility table.

**Diagnostic**: "Cannot apply '*' to Duration and Duration. Duration can be multiplied by Integer, not by another Duration."

## Questions for the committee

1. Should expression-form defaults support boolean expressions (e.g. `enabled: Boolean = core/config.feature_flag and env/config.is_production`), or should they be restricted to arithmetic?
2. Should parenthesised sub-expressions be permitted for explicit precedence (`(base + 1) * 2`), or should expressions be flat?
3. Is the type compatibility table above complete, or should it include other type combinations (e.g. `Integer + Duration` producing `Duration`)?
