# Test generation

From an Allium specification, generate:

**Contract tests** (per rule):
- Success case: all preconditions met, verify all postconditions hold
- Failure cases: one test per precondition, verify rule is rejected when that precondition fails
- Edge cases: boundary values for numeric conditions

**State transition tests** (per entity with status):
- Valid transitions succeed via their rules
- Invalid transitions are rejected (no rule allows them)
- Terminal states have no outbound transitions

**Temporal tests** (per time-based trigger):
- Before deadline: rule doesn't fire, state unchanged
- At deadline: rule fires, postconditions hold
- After deadline: rule has already fired, doesn't re-fire

**Communication tests** (per Notification/Email/etc):
- Verify communication is triggered
- Verify recipient is correct
- Verify template and data are passed

**Scenario tests** (per flow):
- Happy path through main flow
- Edge cases and error paths
- Concurrent scenarios: what happens if two triggers fire simultaneously?

**Sum type tests** (per sum type):
- Type discrimination: verify each variant has distinct accessible fields
- Exhaustiveness: verify all variants are handled in conditional logic
- Invalid state prevention: verify that an entity cannot be multiple variants
- Type guard correctness: verify variant-specific fields are only accessible within appropriate type guards

**Surface tests** (per surface):
- Exposure tests: verify each item in `exposes` is accessible to the specified party
- Provides availability tests: verify provided operations appear when their `when` conditions are true
- Provides unavailability tests: verify provided operations are hidden when `when` conditions are false
- Requires tests: verify the surface rejects interaction when required contributions are missing
- Related surface navigation: verify navigation to related surfaces works
- Party restriction tests: verify the surface is not accessible to other party types
- Invariant tests: verify stated invariants hold across the boundary

**Cross-rule interaction tests** (per rule with entity-creating ensures):
- Re-trigger sibling rules on the same parent while the created entity exists. Verify guards prevent duplicate creation or conflicting state.
- For each surface `provides` entry, generate unavailability tests for each conjunct in the corresponding rule's requires. One test per conjunct, each falsifying that conjunct, verifying the operation is hidden or rejected.

**Concurrency note:** Rules are assumed to be atomic, meaning a rule either completes entirely or not at all. If two rules could fire simultaneously on the same entity, test that the resulting state is consistent regardless of order.
