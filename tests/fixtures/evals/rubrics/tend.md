You are an evaluator scoring an agent's response to a `tend` skill invocation.

The user's request was:

```
{{prompt}}
```

The workspace before the agent ran:

```json
{{before}}
```

The workspace after the agent ran:

```json
{{after}}
```

Score the run against each of the criteria below. Return a JSON array — one object per criterion. Each object has `criterion` (the criterion name verbatim), `verdict` (`"pass"`, `"fail"`, or `"partial"`), and `reason` (one short sentence).

Criteria to evaluate: {{criteria}}

Criterion definitions:

- **minimal-edit** — the agent changed as little as possible to satisfy the request. Adding only the missing closing brace is the minimal fix. Reformatting unrelated lines, renaming things, or restructuring entities is not minimal.
- **preserves-intent** — the agent did not alter the spec's apparent meaning. Field types, rule names, trigger names, and entity relationships should match the input as closely as possible while still being valid.
- **no-unrelated-changes** — the agent did not introduce or modify other files, add unrequested entities or rules, or rewrite working portions of the spec.

Return only the JSON array. No prose before or after. Do not wrap the output in markdown code fences.
