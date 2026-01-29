# allium-check

A CLI tool for checking [Allium](../README.md) specification files for semantic errors.

## Installation

```bash
npm install
npm run build
```

## Usage

```bash
node dist/cli.js <file.allium>
```

Or link globally:

```bash
npm link
allium-check <file.allium>
```

## Exit Codes

- `0` - No errors found
- `1` - Errors found (or file not found)

## Output Format

Errors are printed to stderr, one per line:

```
file:line:col: message
file:line:col: message (did you mean 'suggestion'?)
```

## Example

Given this spec with errors:

```allium
entity User {
    email: Email
    status: active | suspended
    profile: Proflie          -- typo in type
}

entity Post {
    author: Usr               -- typo in entity reference
}

rule SuspendUser {
    when: AdminSuspends(admin, user)

    requires: usr.exists      -- typo in variable
    ensures: user.status = suspendd   -- typo in enum value
}
```

Running the checker:

```
$ allium-check example.allium
example.allium:5:14: undefined type 'Proflie'
example.allium:9:13: undefined entity 'Usr' (did you mean 'User'?)
example.allium:15:15: undefined identifier 'usr' (did you mean 'user'?)
example.allium:16:27: invalid enum value 'suspendd' for field 'status' (expected: active | suspended) (did you mean 'suspended'?)
```

## Checks

### Reference Resolution

- Undefined entity references
- Undefined type references
- Undefined field/relationship references
- Undefined variables
- Typo suggestions via Levenshtein distance

### Enum Validity

- Invalid enum values in assignments
- Invalid enum values in comparisons
- Typo suggestions for near-matches

<details>
<summary><strong>Future Work</strong></summary>

### State Machine Analysis

- **Unreachable states** - enum values defined but no rule transitions to them
- **Missing exits** - non-terminal states with no outbound transitions
- **Undefined transitions** - rules setting status to values not in the enum

### Rule Structure

- **Temporal rules without guards** - will re-fire infinitely without a status check
- **Contradictory preconditions** - rules that can never fire
- **Missing triggers** - rules without `when` clause
- **Missing postconditions** - rules without `ensures` clause

### Expression Validity

- **Circular dependencies** - derived values that reference each other
- **Unbound variables** - variables used before `let` binding
- **Invalid lambda syntax** - `items.any(name)` instead of `items.any(i => i.name)`

### Type Checking

- **Type mismatches** - comparing incompatible types
- **Invalid operations** - wrong collection operations for type
- **Field existence** - accessing fields that don't exist on an entity

### Warnings (non-blocking)

- Unused entities or fields
- Open questions present in spec
- Deferred specifications without location hints
- External entities without governing spec reference

### CLI Enhancements

- `--json` flag for structured output
- `--warn` flag to include warnings
- `--fix` flag for auto-fixable issues
- Multi-file support with imports
- Watch mode for continuous checking

</details>

## Development

```bash
npm run build    # compile TypeScript
npm run dev      # watch mode
npm test         # run integration tests
```

### Running Tests

```
$ npm test

▶ valid specs
  ✔ valid.allium passes with no errors
  ✔ ecommerce.allium passes with no errors
  ✔ project-mgmt.allium passes with no errors
▶ invalid.allium
  ✔ exits with code 1
  ✔ catches undefined type Proflie
  ✔ catches undefined entity Usr with suggestion
  ...
▶ error output format
  ✔ follows file:line:col: message format
  ✔ includes line numbers

ℹ tests 20
ℹ pass 20
```

### Project Structure

```
src/
├── cli.ts              # CLI entry point
├── lexer.ts            # Tokenizer
├── parser.ts           # Recursive descent parser
├── ast.ts              # AST type definitions
├── types.ts            # Diagnostic types
├── symbols.ts          # Symbol table builder
└── checks/
    ├── references.ts   # Reference resolution check
    └── enums.ts        # Enum validity check
```
