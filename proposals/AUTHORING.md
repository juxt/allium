# Writing an ALP

An ALP exists to give an idea the fairest hearing possible. The committee's job is to explore the design space and reach a verdict. The author's job is to make the problem clear enough that the committee can do that well.

Most of the work in writing a good ALP is resisting the urge to solve the problem. A proposal that arrives with a preferred solution narrows the committee's field of vision before debate begins. Panellists anchor on the presented option, critique it, and may never consider the approach that would have emerged from open discussion. The best ALPs constrain the committee as little as possible.

## What an ALP should contain

### The problem

State what is difficult, impossible or error-prone under the current language. Be concrete. Show the code that fails, the workaround that is required, the spec that misleads. If the problem only arises in specific domains or at specific scales, say so.

A good problem statement is falsifiable. A reader should be able to disagree that this is a problem, and the ALP should give them enough evidence to test that disagreement. "Enum literals cannot contain hyphens" is falsifiable. "The enum syntax feels limiting" is not.

### Evidence

Demonstrate that the problem is real and recurring, not hypothetical. Where possible, point to external standards, existing specs, or patterns file entries that exhibit the limitation. If the problem has only been encountered once, that is worth stating honestly; a rare problem may still deserve a language change, but the committee should know the frequency.

### Design tensions

Identify the forces that make the problem hard. These are not solutions; they are constraints that any solution must navigate. What existing language properties are in tension with fixing the problem? What would a naive fix break?

Design tensions help the committee without anchoring them. They say "here is what makes this tricky" rather than "here is what to do about it". A well-identified tension often points toward solutions that the author did not anticipate.

### Scope

State what the ALP is about and what it is not about. If the problem touches adjacent concerns, draw the boundary explicitly. A proposal that tries to solve three problems at once will be debated as three proposals whether the author intended it or not.

## What an ALP should not contain

### Solutions

Do not propose a specific syntax, keyword, grammar change or mechanism. Do not present "options" with a recommended choice. Do not sketch grammar productions. The committee exists to generate and evaluate solutions; pre-empting that process anchors debate and narrows the outcome.

If you have a solution in mind, that is fine. Bring it to the debate, not to the document. The ALP is the brief; the committee session is the hearing.

### Recommendations

Do not express a preference among approaches, even implicitly. Phrases like "the simplest fix would be", "a natural approach is", "this suggests" all point the reader toward a conclusion. Present the problem and the tensions. Let the committee draw conclusions.

### Evaluation of hypothetical approaches

Do not list pros and cons of solutions you have imagined. This is the most common form of anchoring in ALPs: presenting a "design space" with options labelled A through D, where the framing makes one option look obviously superior. Even a balanced presentation of options constrains the committee to those options. The design space is the committee's to explore.

### Judgements about severity

Do not characterise the problem as "critical", "minor", "cosmetic" or "blocking". The committee assesses severity through debate. An author's severity judgement can discourage the committee from taking a "minor" problem seriously or pressure them into acting on a "critical" one before they have thought it through.

## Format

```markdown
# ALP-N: Short descriptive title

**Status**: proposed
**Constructs affected**: which language constructs are involved
**Sections affected**: which sections of the language reference would change

## Problem

[Concrete description of the limitation, with code examples showing what fails or what workaround is required.]

## Evidence

[External standards, existing specs, patterns file entries, or usage scenarios that demonstrate the problem is real and recurring.]

## Design tensions

[Forces that make the problem hard. Constraints any solution must navigate. Not solutions.]

## Scope

[What this ALP is and is not about. Boundaries with adjacent concerns.]
```

The status field starts as `proposed`. The committee changes it to `adopt`, `reject`, `refine` or `split` per the protocol in TEAM.md. The committee's report is appended to the ALP after debate.

## Preparing for committee review

Before submitting an ALP, test it against these questions:

- Could a panellist read this and come away with no idea what solution I prefer? If not, the ALP is anchoring.
- Could a panellist disagree that this is a problem? If not, the problem statement may be too vague to be falsifiable.
- Does the ALP contain the word "should"? Outside the scope section, "should" usually signals a hidden recommendation.
- Are the design tensions about the problem or about a specific solution? Tensions like "hyphens collide with subtraction" are about the problem space. Tensions like "backtick quoting adds visual noise" are about a specific approach and should be removed.
- Would removing any section leave the committee less informed about the problem? If not, the section is not earning its place.
