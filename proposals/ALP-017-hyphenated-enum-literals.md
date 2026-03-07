# ALP-17: Externally-defined enum values

**Status**: adopt
**Constructs affected**: `enum`, inline enum declarations
**Sections affected**: enumerations, field types, naming conventions, validation rules, glossary

## Problem

Enum literals must be valid snake_case identifiers: lowercase letters, digits and underscores. External standards that define canonical values at system boundaries use characters outside this set. Hyphens, dots, colons, plus signs, mixed case and leading digits all appear in standards that Allium specs routinely need to reference.

```
enum InterfaceLanguage {
    en | de | fr | de-CH-1996 | es
}
error: expected enum variant, found '-'
  76 |     en | de | fr | de-CH-1996 | es
     |                      ^
```

The workaround is substituting underscores for hyphens and lowercasing: `de_ch_1996`. This introduces a silent mapping between the spec and the external standard it references. Nothing in the language marks or enforces the correspondence. A reader comparing the spec against the source registry must mentally translate between conventions, and bugs in that translation are invisible to the checker. The cost scales with every external standard a spec touches.

## Evidence

IETF BCP 47 language tags are the sharpest case. Tags like `de-CH-1996`, `zh-Hant-TW` and `sr-Latn` are defined by an international standard, widely used at system boundaries, and contain hyphens as meaningful structural separators and mixed-case subtags (language, script, region, variant). Any spec that models user-facing localisation, content negotiation or regulatory jurisdiction is likely to encounter them.

The same structural pattern appears in other standards:

- HTTP cache directives: `no-cache`, `no-store`, `must-revalidate` (hyphens)
- MIME type components: `vnd.api+json` (dots, plus signs)
- ISO 3166-2 subdivisions: `GB-ENG`, `US-CA` (hyphens, uppercase)
- CSS custom properties, OpenAPI operation IDs and various registry identifiers use characters outside the snake_case set

Allium specs describe observable behaviour at system boundaries, and system boundaries are where external naming conventions appear. When the language cannot represent those conventions directly, every affected spec carries an implicit translation table that exists only in the reader's head.

## Design tensions

**Context-free tokenisation.** The `-` character is the subtraction operator in expressions. Any mechanism that gives `-` a different meaning inside enum literals makes tokenisation context-dependent: the lexer must know whether it is inside an enum declaration or an expression to decide how to classify `-`. The first-round panel unanimously rejected context-dependent tokenisation of `-` as too costly for both tooling and LLM generation. This is a hard constraint, not a trade-off.

**The case convention is load-bearing.** Allium distinguishes enum literals (lowercase) from variant references (capitalised) by case. External standards use mixed case freely: BCP 47's `de-CH-1996` contains the uppercase region subtag `CH`. Any mechanism that admits externally-defined values must either preserve the case convention's role as a syntactic invariant or provide an alternative signal that readers and the checker can use to distinguish enum literals from variant references.

**Identifier uniformity.** Enum literals currently share the snake_case character set with field names, config parameters and derived values. Admitting non-identifier characters in enum values, but not in other identifier categories, creates an asymmetry. The scope of that asymmetry needs an explicit boundary to prevent it from spreading.

**Allium-native vs externally-owned.** The language currently has no way to mark a value as belonging to an external standard rather than to the spec's own vocabulary. The underscore workaround makes external values look like native identifiers, hiding their origin. A solution that makes the distinction visible at the declaration site would give readers and tooling a signal that the naming conventions in play are not Allium's own.

## Scope

This ALP concerns the representation of externally-defined values as enum literals. It does not concern field names, entity names, config parameters or any other identifier category. It does not propose changes to the subtraction operator or to arithmetic expressions. Whatever mechanism is adopted for enum literals, its applicability to other syntactic positions is a separate question for a future ALP.

---

## Panel review (round 1)

**Status**: refine
**Date**: 2026-03-06

### Summary

One proposal was debated. ALP-017 identifies a real and recurring problem: Allium cannot faithfully represent externally-defined values that use hyphens, mixed case or other non-identifier characters. The panel converged on a quoting mechanism as the preferred direction, rejecting bare hyphens in the grammar, but the proposal as written does not commit to a concrete syntax. The verdict is **refine**: the proposal should return with a specific quoting form and explicit scope boundaries.

### Initial responses

**Simplicity advocate:** The underscore convention works. It is a convention, not a defect. The proposal identifies a real friction (mental translation against external standards) but the cure is worse: it entangles the lexer's treatment of `-` with syntactic position, breaks the uniform character set shared by all lowercase identifiers, and opens the door to mixed-case literals that erode the capitalisation convention Allium uses to distinguish enums from variants. One implicit translation table in the reader's head is cheaper than a permanent special case in the grammar.

**Machine reasoning advocate:** A context-dependent `-` is the central risk. In expression positions, `de-CH` parses as `de` minus `CH`; in enum declarations and literal comparisons, it would parse as a single token. An LLM generating or editing a spec must track which syntactic context it is in to decide how to tokenise `-`, and that is exactly the kind of lookalike-but-different construct that causes silent generation errors. If the proposal moves forward, a quoting mechanism (even a simple one like backticks around the literal) would keep `-` unambiguous everywhere and preserve the property that each token can be classified without reference to its surrounding grammar. Context-free tokenisation matters more here than surface fidelity to external standards.

**Composability advocate:** The proposal correctly identifies the narrow-vs-general tension but doesn't resolve it. Hyphens are today's problem; dots, colons and leading digits are tomorrow's, and each will need its own ALP if we bake hyphen support into the bare grammar. A quoting mechanism (backticks, single quotes, angle brackets) solves all of these uniformly, preserves the clean invariant that unquoted identifiers are always snake_case or PascalCase, and leaves no ambiguity with the subtraction operator. It also generalises naturally if we ever need quoted identifiers in other positions. I'd want to see the quoting alternative explored seriously before accepting a special case that constrains future lexer decisions.

**Readability advocate:** The underscore workaround is a genuine readability problem. When a product owner sees `de_CH_1996` in a spec and `de-CH-1996` in the standard they work with daily, they either stumble over the mismatch or learn to silently translate, and both outcomes erode trust in the spec as a source of truth. Specs should speak the same language as the domain, and if the domain says `de-CH-1996`, the spec should too. I would rather accept some added complexity in the parser than force every non-technical reader to maintain a mental mapping between what they read in the spec and what they see in the real system.

**Rigour advocate:** The proposal names the subtraction ambiguity but defers resolving it, which is the wrong order. Before this goes further I need the precise grammar production: in `de-CH-1996`, is `-CH` a subtraction of identifier `CH` from `de`, or is the whole string a single token? Context-dependent lexing (hyphens mean subtraction in expressions, literal separators in enum declarations) makes the grammar non-regular and forces the checker to carry parser state into the lexer, which is a real compositional hazard if enum literals ever appear inside expressions such as comparison guards. The capitalisation question is equally unresolved: if `de-CH-1996` is admitted as a lowercase enum literal, the case convention that currently lets readers and the checker distinguish enum literals from variant references at a glance is no longer a syntactic invariant but a heuristic. The proposal should commit to a denotation, whether that is a quoting mechanism, a restricted production, or something else, before the panel evaluates trade-offs against alternatives.

**Domain modelling advocate:** This is a genuine pain point. When a spec models localisation preferences or content negotiation, stakeholders say "de-CH-1996" in conversation and the standard says `de-CH-1996` in its registry. Forcing `de_CH_1996` in the spec means the ubiquitous language silently diverges from the domain's actual vocabulary, and that divergence sits in a place the checker cannot catch. External standards define the domain's terms at system boundaries, which is precisely where Allium specs live. Getting enum literals to match those terms exactly is worth the syntactic complexity it introduces.

**Developer experience advocate:** The error message in the motivating example is already pretty good: it points right at the hyphen and says what it expected. That's half the battle won before this proposal even lands. My concern is what happens after the fix. If we allow hyphens and mixed case in enum literals but nowhere else, the newcomer now has to learn when snake_case applies and when it doesn't, and the answer is "it depends on whether your enum values come from an external standard". That's a rule you can only learn by getting it wrong. I'd want whatever mechanism we choose to be syntactically obvious at the declaration site, something a reader can see and think "ah, different rules apply here", rather than silently widening what counts as a valid literal everywhere.

**Creative advocate:** Hyphens are a symptom, not the disease. The real gap is that Allium has no way to say "this value is an opaque token owned by an external standard", and bolting hyphen support onto enum syntax papers over that. A general quoted-literal form, something like `'de-CH-1996'` or `#de-CH-1996`, would solve hyphens, dots, colons and mixed case in one move, while making the intent legible: this value is foreign, not part of Allium's own naming world. That distinction is worth more than any single character-class fix, and it opens the door to modelling MIME types, URIs and other boundary values that will inevitably follow.

**Backward compatibility advocate:** The proposal is careful to frame this as additive, but it leaves too much unresolved for me to judge the migration cost. If hyphens are allowed in bare enum literals, every existing spec that used `de_CH_1996` as a workaround now has two ways to spell the same concept, and nothing forces or even nudges authors toward the canonical form. What is the migration path for those specs: do underscore workarounds remain valid indefinitely, or does a future version deprecate them, requiring human judgement to distinguish genuine snake_case literals from hyphen-substitution workarounds? I need to see a concrete syntax proposal before I can assess whether this is genuinely additive or whether it introduces a parsing ambiguity that forces changes to existing expression handling.

### Rebuttals

**Readability advocate** (to simplicity advocate): The "one implicit translation table" you dismiss is not a fixed cost; it scales with every external standard the spec touches, and it is invisible to the checker. A quoting mechanism, which several panellists now favour, would make the foreign origin explicit at the declaration site without widening the bare grammar. That addresses your concern about entangling the lexer while addressing mine about domain fidelity.

**Machine reasoning advocate** (to readability advocate): I agree the mismatch is real, but the solution matters more than the motivation. A quoting mechanism gives an LLM a single, context-free rule: quoted tokens are opaque literals, unquoted tokens follow normal identifier rules. That is strictly easier to learn and generate than a context-dependent hyphen.

**Rigour advocate** (to domain modelling advocate): I share your diagnosis but not your tolerance for unresolved ambiguity. The proposal as written asks us to accept the problem is worth solving without committing to a denotation, and that sequence is backwards. Once we agree on a quoting mechanism with precise grammar productions, I have no objection to matching external standards exactly.

**Composability advocate** (to creative advocate): We are saying the same thing. A quoted-literal form is the general mechanism I asked for, and your framing of it as "marking foreign values" gives it a stronger semantic justification than I offered. The key constraint is that whatever delimiter we choose must not collide with existing syntax or consume space we need for future constructs.

**Domain modelling advocate** (to rigour advocate): Fair. I am not attached to bare hyphens in the grammar; I am attached to the spec being able to say `de-CH-1996` rather than `de_CH_1996`. If a quoting form achieves that, I am satisfied.

**Developer experience advocate** (to machine reasoning advocate): A quoting mechanism also passes the "day one" test better than bare hyphens. A newcomer who sees `'de-CH-1996'` immediately understands that something special is happening; a newcomer who sees `de-CH-1996` without quotes has to discover the hyphen rule by trial and error. I am converging toward the quoting approach.

**Backward compatibility advocate** (to composability advocate): A quoting mechanism is also cleaner for migration. Existing underscore workarounds remain valid snake_case literals. Authors can adopt quoted forms incrementally for new specs or when revisiting existing ones, with no forced rewrite and no ambiguity about which literals are workarounds.

**Simplicity advocate** (to composability advocate): I concede that a quoting mechanism is less entangling than bare hyphens. My residual concern is scope: if we introduce quoting for enum literals, do we eventually need it for field names, entity names and config keys? The proposal should explicitly close that door.

### Synthesis

The panel converged substantially during rebuttals.

**Resolved concerns.** The readability, domain modelling, machine reasoning, developer experience and backward compatibility advocates all converged on a quoting mechanism as the preferred approach. The rigour advocate's demand for a precise grammar production was acknowledged as a prerequisite, not an objection to the goal. The composability and creative advocates found their positions aligned: a general quoting form solves hyphens, dots, colons and mixed case uniformly, without burdening the lexer with context-dependent tokenisation.

**Remaining concerns.** Two issues survive rebuttals. First, the simplicity advocate's question about scope creep: if quoting is introduced for enum literals, the language needs an explicit boundary preventing its spread to other identifier categories. Second, the rigour advocate's requirement stands: no verdict is possible on a concrete syntax until the proposal specifies one. The current ALP identifies the problem and the design tensions but does not commit to a mechanism, and the panel cannot evaluate trade-offs against an unspecified solution.

**Panel alignment.** All nine panellists accept the problem as real and recurring. Eight of nine favour a quoting mechanism over bare hyphens. The simplicity advocate accepts quoting as less harmful than bare hyphens but wants the scope explicitly bounded. No panellist argued for the status quo as a permanent answer.

### Verdict: refine

The panel agrees the problem is worth solving and has converged on a quoting mechanism as the preferred direction, but the current proposal does not specify a concrete syntax. The next iteration should:

1. Propose a concrete quoting syntax (backticks, single quotes or another delimiter) with grammar productions.
2. State the explicit scope: which syntactic positions admit quoted literals (enum declarations, field comparisons, pattern matches) and which do not (field names, entity names, config keys).
3. Specify the semantics of quoted literals in comparisons and `ensures` clauses.
4. Provide before-and-after examples, including coexistence of underscore workarounds with quoted forms.

**Position for quoting (strongest form).** A quoted-literal form marks values as foreign to Allium's naming world. It solves hyphens, dots, colons, mixed case and leading digits in one mechanism. It keeps the lexer context-free, preserves the case convention for distinguishing enums from variants, and gives readers and LLMs a single rule: quoted tokens are opaque, unquoted tokens follow normal identifier rules. Migration is incremental; existing underscore workarounds remain valid.

**Position for bare hyphens (strongest form).** A quoting mechanism adds ceremony to values that domain experts already recognise on sight. `de-CH-1996` is more legible than `'de-CH-1996'` to a product owner who works with language tags daily. Quoting treats domain-native values as foreign when they are, in fact, the authoritative form. The syntactic cost of context-dependent `-` may be acceptable if restricted to enum declaration and literal comparison positions where subtraction is not valid.

### Deferred items

- **Choice of quoting delimiter.** The panel did not evaluate specific delimiters (backticks, single quotes, `#`-prefixed forms). Deferred to the refined proposal.
- **Scope boundary for quoted literals.** Whether quoting should be restricted to enum literals or extended to other value positions (e.g. string-like constants at system boundaries). Deferred to the refined proposal.
- **Interaction with the `external` keyword or future import mechanisms.** The creative advocate's observation that the deeper issue is the lack of an "externally-owned value" concept was noted but not explored. Deferred to the language author.

---

## Panel review (round 2)

**Status**: adopt
**Date**: 2026-03-06

### Summary

One proposal was debated. The refined ALP-017 returns with a concrete syntax (backtick-quoted literals), explicit scope boundaries, grammar productions and before-and-after examples, addressing all four items from the round 1 refine verdict. The panel reached consensus: **adopt**, with one refinement to the character class in the grammar production.

### Refined proposal

Enum values containing characters outside the snake_case set are enclosed in backticks:

```
enum InterfaceLanguage {
    en | de | fr | `de-CH-1996` | es | `zh-Hant-TW` | `sr-Latn`
}
```

Grammar production:

```
enum_literal     ::= snake_case_id | quoted_literal
quoted_literal   ::= '`' literal_char+ '`'
literal_char     ::= any printable Unicode character (categories L, M, N, P, S)
                     except '`' and whitespace
snake_case_id    ::= [a-z][a-z0-9_]*
```

Scope: backtick-quoted literals are permitted in enum declarations (named and inline), literal comparisons, pattern matching in rules and `ensures` clauses. They are not permitted as field names, entity names, variant names, config parameter names, derived value names, or rule/trigger/invariant names. This boundary is structural: values and identifiers occupy distinct grammar productions.

Semantics: a backtick-quoted literal is a value, not an identifier. It participates in equality comparison and assignment, nothing else. Quoted and unquoted forms are distinct values with no implicit normalisation. Quoted literals are opaque to the checker: no case convention checking, no snake_case enforcement. Comparison is byte-exact after UTF-8 encoding; authors are responsible for using the canonical form from the external standard.

### Initial responses

**Simplicity advocate:** The proposal does what I asked for in round 1: it picks a delimiter, draws a scope boundary and closes the door explicitly. Backtick quoting is acceptable. The scope restriction (enum values and their comparison sites only, never identifiers) is the load-bearing clause, and the proposal states it as absolute. The semantics are clean: no implicit normalisation between `de_ch_1996` and `de-CH-1996` is correct. My remaining concern is minor: the grammar should restrict to printable characters rather than admitting arbitrary Unicode, but I will not block on it.

**Machine reasoning advocate:** Backtick quoting is the right answer. The grammar production gives the lexer a single, unambiguous rule that requires no lookahead and no knowledge of surrounding context. The "no implicit normalisation" rule is load-bearing for machine reasoning: a model never has to decide whether two spellings are equivalent, it just compares tokens. Backticks have no existing role in Allium's grammar, no collision path with string literals or generics, and they are visually distinct from both single quotes and comment markers.

**Composability advocate:** The refined proposal lands where I hoped it would. Backtick quoting preserves the invariant that unquoted tokens are always classifiable by their character set alone, while admitting arbitrary external values through a single, uniform mechanism. The grammar production is context-free, composes with existing comparison and assignment syntax without special-case handling, and generalises to dots, colons, plus signs and mixed case without further ALPs. One note: the scope constraint should be a property of the grammar (values and identifiers occupy distinct productions), not a procedural promise about future proposals.

**Readability advocate:** Backtick quoting delivers what I asked for in round 1: the spec can now say `de-CH-1996` rather than `de_CH_1996`, and a product owner reading the spec sees the same value they see in the standard. The backtick delimiter is visually lightweight enough that it does not bury the value in ceremony, yet distinct enough that a reader registers "this value plays by different rules". The scope boundaries are well drawn. The "no implicit normalisation" rule is important: existing specs do not silently change meaning, and authors make a conscious choice to adopt the canonical external form.

**Rigour advocate:** The refined proposal addresses my round 1 objection: we now have a concrete grammar production and explicit scope boundaries. The `quoted_literal` production is context-free, unambiguous and composes cleanly with the existing lexer. One concern survives: the `literal_char` production admits control characters, null bytes, directional overrides and other sequences that could produce visually identical literals with distinct byte representations. The production should restrict to printable Unicode so that equality remains decidable by byte comparison without hidden ambiguity.

**Domain modelling advocate:** Backtick quoting with the proposed scope delivers exactly what I asked for: the domain's own vocabulary survives intact into the specification. Enum values are the one position where external standards impose their naming conventions on Allium, and limiting quoting to value positions matches the real asymmetry between externally-owned vocabulary and spec-internal structure. The semantics are right: no implicit normalisation means the quoted literal is the standard's literal, not an Allium approximation of it.

**Developer experience advocate:** Backtick quoting passes the day-one test. A newcomer who sees `de-CH-1996` in backticks immediately knows that different rules apply; there is no silent widening of what counts as a valid identifier. The "no implicit normalisation" rule is correct because the alternative would create invisible bugs. One suggestion: tooling should hint when an enum contains both underscore workarounds and backtick-quoted literals for similar-looking values, to shorten the mistake-to-correction cycle during incremental migration.

**Creative advocate:** Backticks are the right delimiter and the scope is drawn correctly. What this proposal quietly achieves is giving Allium a notion of "foreign value" for the first time: backticks are the visual signal that a literal belongs to a world outside the spec's own naming conventions. That matters more than the character-class fix. The proposal stops short of letting the declaration site name the owning standard (e.g. `enum InterfaceLanguage [BCP 47] { ... }`), which would be a natural follow-up ALP.

**Backward compatibility advocate:** The refined proposal answers every question I raised in round 1. Backtick quoting is cleanly additive: existing underscore workarounds remain valid snake_case literals, the two forms are explicitly distinct values with no implicit normalisation. Migration is opt-in, which is the only acceptable model for a language where no tool can distinguish genuine snake_case literals from hyphen-substitution workarounds. The scope boundary is tight and the durability guarantee is present.

### Rebuttals

**Simplicity advocate** (to creative advocate): You framed quoting as the first step toward a general "externally-owned value" concept. The proposal succeeds precisely because it is narrow: enum literals, nothing else. If this becomes the thin end of a wedge toward quoted identifiers or external-value annotations, the complexity budget spent here will have bought scope creep rather than contained it. Evaluate this as a terminus, not an opening.

**Composability advocate** (to simplicity advocate): Your scope creep concern is now answered structurally. The grammar production makes quoted literals a peer of `snake_case_id` inside `enum_literal`, not a general-purpose escape hatch. The boundary you wanted is structural, not just declared.

**Machine reasoning advocate** (to rigour advocate): Your demand for precise grammar productions is satisfied. I would push further: the proposal should explicitly state that backtick-quoted literals are not permitted inside arithmetic expressions, even in positions where an enum value could theoretically appear, to prevent ambiguity if future ALPs introduce expression contexts where enum comparisons are valid.

**Rigour advocate** (to domain modelling advocate): We are aligned on the goal. My caution: "matching external standards exactly" requires that the comparison semantics be exact too. The proposal should specify that comparison is byte-exact after UTF-8 encoding, so that "exactly" has a denotation rather than being an aspiration.

**Domain modelling advocate** (to simplicity advocate): The asymmetry between values and identifiers is not a defect of the design but a reflection of how domains work: external standards dictate their values, not your field names. The scope boundary is principled, not arbitrary.

**Developer experience advocate** (to backward compatibility advocate): The coexistence model is sound, but "opt-in" only works if authors know the option exists. Tooling guidance alongside this ALP, a checker hint that flags half-converted enums carrying two representations of the same external concept, would shorten the migration path without forcing it.

**Creative advocate** (to rigour advocate): Your concern about `literal_char` breadth is valid. Restricting to printable Unicode is a refinement worth making. It does not change the verdict.

**Backward compatibility advocate** (to creative advocate): Backtick quoting solves the immediate problem without requiring authors to restructure existing specs. If a future ALP introduces a richer external-value concept, backtick literals are a natural migration target. Ship the simple, additive change now; build the richer abstraction later if the need materialises.

### Synthesis

The panel reached consensus with no substantive objections surviving rebuttals.

**Resolved concerns.** The simplicity advocate's round 1 concern about scope creep, the central obstacle in round 1, is answered by the structural scope boundary: backtick-quoted literals participate in the `enum_literal` production alongside `snake_case_id`, and identifiers occupy a separate production entirely. The composability advocate confirmed this boundary is grammatical, not merely procedural. The rigour advocate's demand for precise grammar productions and explicit semantics, the prerequisite that forced the round 1 refine verdict, is satisfied. The readability, domain modelling, developer experience and backward compatibility advocates all confirmed that the proposal delivers what they asked for: domain-faithful values, opt-in migration, no forced rewrites.

**Refinement adopted.** The rigour advocate's concern about the `literal_char` production admitting control characters and Unicode normalisation ambiguity was accepted by both the simplicity and creative advocates. The production is tightened to printable Unicode characters (categories L, M, N, P, S) excluding backtick and whitespace, with byte-exact comparison after UTF-8 encoding. This eliminates invisible-difference bugs without restricting any character that appears in real external standards.

**Noted for future work.** The creative advocate's observation that backtick quoting implicitly introduces a "foreign value" concept was acknowledged as productive framing. A provenance annotation naming the external standard at the enum declaration site (e.g. `[BCP 47]`) was flagged as a natural follow-up ALP. The developer experience advocate's suggestion of checker hints for half-migrated enums was noted as a tooling concern, not a language-level change. Neither blocks adoption.

**Panel alignment.** All nine panellists support adoption. No reservations were recorded.

### Verdict: adopt

Backtick-quoted literals are adopted for externally-defined enum values, with the following specification:

**Grammar:**
```
enum_literal     ::= snake_case_id | quoted_literal
quoted_literal   ::= '`' literal_char+ '`'
literal_char     ::= any printable Unicode character (categories L, M, N, P, S)
                     except '`' and whitespace
snake_case_id    ::= [a-z][a-z0-9_]*
```

**Scope:** Backtick-quoted literals are permitted in enum declarations (named and inline), literal comparisons, pattern matching in rules and `ensures` clauses. They are not permitted in identifier positions (field names, entity names, variant names, config parameter names, derived value names, rule/trigger/invariant names). This boundary is structural: the `enum_literal` and identifier productions are disjoint.

**Semantics:** A backtick-quoted literal is a value, not an identifier. It participates in equality comparison and assignment, nothing else. Quoted and unquoted forms are distinct values; no implicit normalisation applies. The checker does not apply case convention rules inside backticks. Comparison is byte-exact after UTF-8 encoding.

**Migration:** Existing specs using underscore workarounds remain valid. The underscore form and the backtick form are distinct values with no equivalence relationship. Authors adopt backtick-quoted forms when they want fidelity to an external standard. No deprecation, no forced rewrite.

**Before and after:**

```
-- Before
enum InterfaceLanguage {
    en | de | fr | de_ch_1996 | es | zh_hant_tw | sr_latn
}

-- After
enum InterfaceLanguage {
    en | de | fr | `de-CH-1996` | es | `zh-Hant-TW` | `sr-Latn`
}
```

### Deferred items

- **Provenance annotation.** A mechanism for naming the external standard at the enum declaration site (e.g. `enum InterfaceLanguage [BCP 47] { ... }`). Flagged by the creative advocate as a natural follow-up ALP. Deferred to a future proposal.
- **Checker hints for half-migrated enums.** Tooling that flags enums containing both underscore workarounds and backtick-quoted literals for similar-looking values. Flagged by the developer experience advocate. Deferred to tooling guidance, not a language-level change.
- **Arithmetic expression exclusion.** Explicit statement that backtick-quoted literals cannot appear inside arithmetic expressions. Flagged by the machine reasoning advocate. The grammar already prevents this (enum literals and arithmetic operands are disjoint productions), but an explicit note in the language reference may aid clarity.

