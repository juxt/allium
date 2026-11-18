# Working with obligation plans

`allium plan <spec>` lists the test obligations a spec implies. `allium diff` compares the obligations of two versions of a spec. Use the recipes below rather than writing a new filter over the JSON each time.

## Plan output

By default `allium plan` prints one JSON document: `{"version": n, "obligations": [...], "diagnostics": [...]}`. Each obligation has an `id`, `category`, `description`, `source_construct` and `source_span`, plus `expression`, `detail` and `dependencies` where they apply.

`allium plan --format tsv <spec>` prints one obligation per line, with five tab-separated columns and no header:

| Column | Content |
|---|---|
| 1 | id, such as `rule-failure.PayOrder.2` |
| 2 | category, such as `rule_failure` |
| 3 | source construct, the rule, entity or surface it comes from |
| 4 | description |
| 5 | expression: the `requires` clause or `.created(...)` call it tests, empty for most other categories |

Comments are dropped from the expression and whitespace is collapsed. A tab, newline or backslash inside a value is written as `\t`, `\n` or `\\`. Diagnostics go to stderr.

## Recipes

```sh
# Count obligations per category
allium plan --format tsv spec.allium | cut -f2 | sort | uniq -c

# The obligations of one rule, entity or surface
allium plan --format tsv spec.allium | awk -F'\t' '$3 == "PayOrder"'

# Look up one id
allium plan --format tsv spec.allium | awk -F'\t' '$1 == "rule-failure.PayOrder.2"'

# The ids that tests name (see "Naming obligations in tests")
grep -rhoE 'obligation: [^[:space:]]+' tests/ | cut -d' ' -f2 | sort -u > named.txt

# Obligations no test names
comm -23 <(allium plan --format tsv spec.allium | cut -f1 | sort) named.txt

# Ids that tests name but the spec no longer has
comm -13 <(allium plan --format tsv spec.allium | cut -f1 | sort) named.txt
```

Replace `tests/` with the project's test directories.

## Naming obligations in tests

Each test names the obligations it covers in a comment, one per line, in the form `obligation: <id>`:

```typescript
// obligation: rule-failure.PayOrder.2
test("rejects payment for an order with no items", () => { ... });
```

The marker is what lets coverage, scoping and `allium diff` find a test by obligation id. Use the comment syntax of the test's language.

## Comparing two versions with `allium diff`

`allium diff <old> <new>` takes two specs, or two outputs of `allium plan` in either format, and works out which it has been given from the content. To compare a spec with an earlier version, read the old side from git:

```sh
# Working tree against the last commit
allium diff <(git show HEAD:specs/order.allium) specs/order.allium

# Two refs, such as two release tags
allium diff <(git show v1.2:specs/order.allium) <(git show v1.3:specs/order.allium)
```

A spec that does not exist at the old ref gives an empty old side, so every obligation is reported as added.

The output has one line per difference, sorted by id. `--format json` gives the same result as `{"added", "removed", "changed", "moved"}`.

| Line | Meaning | What to do with the tests |
|---|---|---|
| `A id` | The obligation is new | Write a test for it |
| `D id` | The obligation is gone | Delete the test that names it, or retarget the test if the behaviour now sits under another obligation |
| `M id` | Same id, different content, usually an edited clause | Review the test against the new `expression` |
| `R old new` | Same content under a new id, because clauses above it were added or removed | Change the test's marker from `old` to `new`; the test itself is still right |

Apply all `R` renames in one pass. They often chain, as in `R .1 .2` followed by `R .2 .3`, and renaming one at a time with search and replace would turn both markers into `.3`.

A clause that is both moved and edited in the same change shows as `D` and `A`, not `M`. Comments are not part of an obligation, so a change that only touches comments gives no output. Inside the Allium loop, the blast radius step in [driving the loop](./driving-the-loop.md) §14 catches comment changes by line instead.

Exit codes follow `diff`: 0 for no differences, 1 for differences, 2 for an error such as an unreadable input or a spec that does not parse.

## Older CLI versions

If `allium diff` fails as an unknown command, or `allium plan --format tsv` fails with a usage message, the installed CLI predates these features. Use the JSON output of `allium plan` instead, compare the ids of the two plans directly, and do not retry the newer commands in the same session. Mention that updating the CLI would make the comparison exact.
