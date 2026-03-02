# ALP-14: Surface clause terminology

**Status**: superseded by ALP-15
**Keywords affected**: `exposes`, `provides`, `expects`, `offers`
**Sections affected**: surfaces, validation rules, glossary, patterns, migration guide

## Problem

Surfaces have four directional clauses that pair naturally into two groups:

- **Data/action clauses** (v1): `exposes` (what the party can see) and `provides` (what the party can do)
- **Obligation clauses** (v2): `expects` (what the counterpart must implement) and `offers` (what this surface supplies as typed operations)

The four words are too similar. `provides` and `offers` are near-synonyms in English. `exposes` and `offers` both gesture at making something available. A reader encountering all four in the same surface must learn an arbitrary mapping between similar words and distinct concepts, rather than inferring the meaning from the vocabulary itself.

The syntactic distinction (colon-delimited vs brace-delimited) helps at the parser level but not at the comprehension level. The language reference already includes a warning for `expects:` with a colon, acknowledging that confusion between the two groups is likely.

This problem is worth addressing now. V2 is not yet released with an installed base of specs using `expects`/`offers`. Renaming the v2 terms is free. Renaming the v1 terms has a cost but is still feasible before adoption grows.

## Design space

### Option A: Keep the current terms

`exposes`, `provides`, `expects`, `offers`. Accept the similarity and rely on documentation and syntactic cues (colons vs braces) to distinguish them.

**For:** No migration cost. The ALP-1 rationale already considered alternatives (`requires`/`provides`, `demands`/`supplies`) and chose `expects`/`offers` as the least-worst option. The words do technically mean different things.

**Against:** The ALP-1 evaluation optimised for avoiding collisions with existing keywords. It did not weight the similarity between `provides` and `offers`, because `provides` was not among the candidates being compared — it was treated as fixed. The result is a global vocabulary where two of four terms are near-synonyms.

### Option B: Rename only the v2 obligation clauses

Keep `exposes` and `provides`. Replace `expects` and `offers` with terms that are clearly distinct from the v1 pair.

Candidates for the obligation pair:

- `requires_impl` / `supplies_impl` — explicit but ugly, breaks the keyword-as-single-word convention
- `demands` / `supplies` — rejected in ALP-1 for tone, but worth revisiting in context of the full quartet
- `consumes` / `produces` — borrows from message-passing vocabulary; clear directionality, no overlap with `exposes`/`provides`
- `needs` / `gives` — short, plain, distinct from the v1 pair, but perhaps too informal
- `accepts` / `serves` — `accepts` is close to `expects`; `serves` is more distinct but has HTTP connotations

**For:** No breaking change. V2 terms have no installed base. The cost is a find-and-replace across the language reference, patterns, migration guide and proposals.

**Against:** Half-measures. If the real problem is the full quartet, renaming two terms still leaves a vocabulary that requires memorisation rather than inference.

### Option C: Rename all four clauses

Redesign the full vocabulary so the two groups are self-evidently distinct. The grouping principle is:

- Group 1 describes what a human party sees and can trigger (data visibility, available actions)
- Group 2 describes what code must implement (typed interfaces with invariants)

Candidate vocabularies:

| Group | Current | Candidate 1 | Candidate 2 | Candidate 3 |
|-------|---------|-------------|-------------|-------------|
| Human sees | `exposes` | `shows` | `exposes` | `displays` |
| Human does | `provides` | `allows` | `permits` | `accepts` |
| Code must implement | `expects` | `expects` | `demands` | `requires_from` |
| Code supplies | `offers` | `delivers` | `supplies` | `provides_to` |

**For:** An opportunity to get the vocabulary right from the start, before any significant installed base exists. A well-chosen quartet could make surfaces self-documenting.

**Against:** Breaking change for v1 terms. Every existing pattern, example and documentation reference to `exposes`/`provides` must change. The v1 terms are not actually confusing in isolation; the confusion only arises when the v2 terms are introduced alongside them. Renaming established terms to fix a problem introduced by new terms inverts the responsibility.

### Option D: Structural separation instead of vocabulary change

Instead of renaming, make the two groups syntactically distinct enough that the vocabulary similarity doesn't matter. For instance, obligation blocks could live in a separate `integration` block within the surface rather than alongside `exposes`/`provides`:

```
surface DomainIntegration {
    facing framework: FrameworkRuntime

    exposes:
        EntityKey
        EventOutcome

    integration:
        expects DeterministicEvaluation { ... }
        offers EventSubmitter { ... }
}
```

**For:** No keyword changes. The structural grouping makes the distinction visible without relying on vocabulary. The brace-delimited blocks already look different; wrapping them in a named section makes the boundary explicit.

**Against:** Adds a new keyword (`integration`) and an indentation level. Surfaces that are purely programmatic (no `exposes`/`provides`) would have a redundant wrapper. The structural fix might be solving the wrong problem if the vocabulary is genuinely confusing even in prose discussion ("does this surface offer or provide that capability?").

## Recommendation

This proposal does not advocate for a specific option. The question for the panel is whether the current vocabulary carries enough ambiguity to justify the cost of changing it, and if so, which option best balances clarity against migration burden.

The sharpest version of the concern: when an engineer says "this surface provides X", do they mean the `provides` clause (available actions) or the `offers` clause (typed operations the surface supplies)? If that sentence is ambiguous in conversation, the vocabulary is failing at its primary job.
