You are evaluating a snapshot mismatch in an Allium spec test suite.

A snapshot test compares text the agent just produced against a committed baseline. When they don't match, you help triage by enumerating each distinct change and classifying it.

The scenario being tested was: **{{scenario_id}}**
The snapshot file: **{{snapshot_file}}**

The committed baseline (expected):

```
{{expected}}
```

What the agent just produced (actual):

```
{{actual}}
```

Unified diff (expected → actual):

```
{{diff}}
```

Walk the diff and identify each distinct conceptual change. A change is one related modification — e.g. "extracted inline enum to named TodoStatus" is one change even if it touches several lines. Renaming a single field consistently across the file is one change, not many.

For each change, classify the severity using these definitions:

- **cosmetic** — comments, whitespace, declaration order, prose phrasing. The two outputs would behave identically.
- **structural** — refactoring that preserves behaviour. Examples: extracting an inline enum into a named enum, splitting one surface into two equivalent ones, renaming a field/parameter consistently, reorganising sections.
- **semantic** — behaviour-changing. Examples: removing a rule or entity, changing a field's type, altering a `requires` clause's logic, changing the transition graph, removing or adding fields a consumer relies on.

Then assign:

- **overall_severity** — the highest severity that appears in your list (semantic > structural > cosmetic).
- **recommendation** — `"accept"` if every change is cosmetic or behaviour-preserving structural; `"investigate"` if any change is semantic OR if a structural change degrades the spec in some way you'd want to confirm.

Return ONLY a JSON object with this exact shape — no prose before or after, no markdown code fences:

```
{
  "overall_severity": "cosmetic" | "structural" | "semantic",
  "recommendation": "accept" | "investigate",
  "changes": [
    {"description": "one short sentence describing the change", "severity": "cosmetic" | "structural" | "semantic"},
    ...
  ]
}
```

Example for a real diff:

```
{"overall_severity":"semantic","recommendation":"investigate","changes":[{"description":"Inline enum on Todo.status extracted to a named TodoStatus enum","severity":"structural"},{"description":"User parameters removed from CompleteTodo and ArchiveTodo rule signatures, removing authorization context","severity":"semantic"},{"description":"ExpireOverdue converted from temporal trigger to explicit POST action","severity":"semantic"},{"description":"External entity Cron replaced with Admin","severity":"structural"}]}
```
