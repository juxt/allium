# A/B harness report

- results dir: `/Users/yavorpanayotov/IdeaProjects/allium-4.0/eval/results/2026-05-16T09-38-23-738Z`
- started: 2026-05-16T09:38:23.739Z
- model: (user default)
- prompt hash: `9b1692cd`

## Per-variant summary

### baseline (1 samples)

- `allium check` pass: **0/1**
- structural counts: _entities/fields from `allium model`; rule-likes & others from text regex_
- entity-like (entity / external entity / variant) median: **6** — per-sample: 6
- rule-like (rule / trigger / invariant) median: **11** — per-sample: 11
- field count (median): **58** — per-sample: 58
- other top-level constructs (totals across samples): actor=8, enum=5, integration=2, job=5, namespace=1, state_machine=3, surface=2
- only one sample — no determinism data

  - sample-1: FAIL (404E / 4W / 57I)
    - error@3:1: expected declaration (entity, rule, enum, value, config, surface, actor, given, 
    - error@5:1: expected declaration (entity, rule, enum, value, config, surface, actor, given, 
    - error@6:1: expected declaration (entity, rule, enum, value, config, surface, actor, given, 
    - … and 462 more

### experimental (1 samples)

- `allium check` pass: **0/1**
- structural counts: _entities/fields from `allium model`; rule-likes & others from text regex_
- entity-like (entity / external entity / variant) median: **6** — per-sample: 6
- rule-like (rule / trigger / invariant) median: **28** — per-sample: 28
- field count (median): **38** — per-sample: 38
- other top-level constructs (totals across samples): contract=2, enum=4, surface=2
- only one sample — no determinism data

  - sample-1: FAIL (342E / 4W / 41I)
    - error@10:27: expected enum variant, found ','
    - error@13:12: expected enum variant, found ','
    - error@14:10: expected enum variant, found ','
    - … and 384 more

## Inter-variant diff: baseline/sample-1 vs experimental/sample-1

### Structural

- entities: Jaccard 1.00

- rules: Jaccard 0.05
  - only in A: claim_amount_bounded_by_policy, claim_only_against_active_policy, approve_requires_completed_assessment, payout_amount_matches_claim, paid_payout_marks_claim_paid, failed_payout_increments_counter, sla_breach_is_observation_only, auto_approval_scope, closed_statuses
  - only in B: register_policy, register_assessor, submit_claim, triage, start_assessment, complete_assessment, approve_claim, deny_claim, schedule_payout, mark_payout_paid, mark_payout_failed, adjuster_approve, auto_acknowledge, assessment_sla_breach, payout_retry, auto_close_denied, auto_approval_scheduler, receive_incident_report, try_link_incident_report, approval_requires_completed_assessment, payout_only_for_approved_or_later, payout_amount_matches_claim_at_schedule_time, denial_reason_iff_denied, terminal_states_immutable, denied_only_transitions_to_closed, claim_amount_within_coverage_at_submit

- field-count delta: -20 (baseline=58, experimental=38)

### Unified text diff

```diff
--- /Users/yavorpanayotov/IdeaProjects/allium-4.0/eval/results/2026-05-16T09-38-23-738Z/baseline/sample-1/spec.allium	2026-05-16 12:42:18
+++ /Users/yavorpanayotov/IdeaProjects/allium-4.0/eval/results/2026-05-16T09-38-23-738Z/experimental/sample-1/spec.allium	2026-05-16 12:46:09
@@ -1,596 +1,526 @@
 -- allium: 3
 
-namespace insurance_claims
+-- Insurance claims processing.
+-- Distilled from app/ (models, services, jobs, routes, webhooks, integrations).
 
-# ---------------------------------------------------------------------------
-# Status enums (state-machine alphabets)
-# ---------------------------------------------------------------------------
+-- =========================================================================
+-- Status enums
+-- =========================================================================
 
-enum PolicyStatus {
-  active
-  lapsed
-  cancelled
-}
+enum PolicyStatus { ACTIVE, LAPSED, CANCELLED }
 
 enum ClaimStatus {
-  submitted
-  triaged
-  assessing
-  approved
-  denied
-  paid
-  closed
+  SUBMITTED,
+  TRIAGED,
+  ASSESSING,
+  APPROVED,
+  DENIED,
+  PAID,
+  CLOSED,
 }
 
-enum AssessmentStatus {
-  pending
-  in_progress
-  completed
-}
+enum AssessmentStatus { PENDING, IN_PROGRESS, COMPLETED }
 
-enum PayoutStatus {
-  scheduled
-  paid
-  failed
-}
+enum PayoutStatus { SCHEDULED, PAID, FAILED }
 
-enum PaymentResultStatus {
-  accepted
-  rejected
-  pending_review
-}
+-- =========================================================================
+-- Temporal constants
+-- =========================================================================
 
-# ---------------------------------------------------------------------------
-# Temporal constants
-# ---------------------------------------------------------------------------
+const ASSESSMENT_SLA          : Duration = days(14)
+const STALLED_AFTER           : Duration = days(21)
+const AUTO_ACK_AFTER          : Duration = business_days(5)
+const PAYOUT_RETRY_AFTER      : Duration = days(28)
+const AUTO_CLOSE_DENIED_AFTER : Duration = days(90)
+const INCIDENT_LINK_WINDOW    : Duration = days(2)
 
-constant ASSESSMENT_SLA: Duration = 14 days
-constant STALLED_AFTER: Duration = 21 days
-constant AUTO_ACK_AFTER_BUSINESS_DAYS: Integer = 5
-constant PAYOUT_RETRY_AFTER: Duration = 28 days
-constant AUTO_CLOSE_DENIED_AFTER: Duration = 90 days
-constant INCIDENT_LINK_WINDOW: Duration = 2 days
-constant AUTO_APPROVE_MAX_PENCE: Integer = 5_000_000
-constant FASTER_PAYMENTS_UPSTREAM_CAP_PENCE: Integer = 100_000_000
+const AUTO_APPROVE_MAX_PENCE  : Integer  = 5_000_000   -- £50,000
 
-# ---------------------------------------------------------------------------
-# Core entities
-# ---------------------------------------------------------------------------
+-- =========================================================================
+-- Entities
+-- =========================================================================
 
 entity Policy {
-  policy_number: String  key
-  holder: String
-  coverage_limit_pence: Integer
-  status: PolicyStatus  default: active
-  holder_tags: Set<String>  default: {}
+  policy_number        : String  identity
+  holder               : String
+  coverage_limit_pence : Integer
+  status               : PolicyStatus  default ACTIVE
+  holder_tags          : Set<String>   default {}
 
-  derived has_open_claims: Boolean =
-    exists(Claim c
+  derived has_open_claims : Boolean =
+    exists c in Claim
       where c.policy == self
-        and c.status not in {paid, denied, closed})
+        and c.status not in { PAID, DENIED, CLOSED }
 }
 
 entity Claim {
-  claim_number: String  key
-  policy: Policy                              # FK distilled from policy_number
-  incident_date: DateTime
-  amount_claimed_pence: Integer
-  submitted_at: DateTime       default: now()
-  last_activity_at: DateTime   default: now()
-  status: ClaimStatus          default: submitted
-  denial_reason: String?       default: null
+  claim_number         : String    identity
+  policy               : Policy                       -- FK to Policy.policy_number
+  incident_date        : DateTime
+  amount_claimed_pence : Integer
+  submitted_at         : DateTime  default now()
+  last_activity_at     : DateTime  default now()
+  status               : ClaimStatus default SUBMITTED
+  denial_reason        : String?
 
-  derived age: Duration = now() - submitted_at
+  derived age           : Duration = now() - submitted_at
+  derived is_within_sla : Boolean  = age <= ASSESSMENT_SLA
 
-  derived is_within_sla: Boolean = age <= ASSESSMENT_SLA
+  -- Implicit state: no `stalled` column; derived from (status, last_activity_at).
+  derived is_stalled    : Boolean  =
+    status == ASSESSING and (now() - last_activity_at) > STALLED_AFTER
 
-  # Implicit state: there is deliberately no `stalled` column —
-  # derived from (status, last_activity_at).
-  derived is_stalled: Boolean =
-    status == assessing
-    and (now() - last_activity_at) > STALLED_AFTER
+  derived total_paid_pence : Integer =
+    sum(p.amount_pence for p in Payout
+        where p.claim == self and p.status == PAID)
 
-  derived total_paid_pence: Integer =
-    sum(Payout p
-      where p.claim == self
-        and p.status == paid
-      select p.amount_pence)
-
-  derived closed: Boolean = status in {paid, denied, closed}
+  derived closed : Boolean = status in { PAID, DENIED, CLOSED }
 }
 
 entity Assessor {
-  name: String  key
-  specialties: Set<String>  default: {}
+  name        : String        identity
+  specialties : Set<String>   default {}
 }
 
 entity Assessment {
-  assessment_id: String  key
-  claim: Claim
-  assessor: Assessor
-  findings: String                   default: ""
-  status: AssessmentStatus           default: pending
-  started_at: DateTime?              default: null
-  completed_at: DateTime?            default: null
+  assessment_id : String              identity
+  claim         : Claim
+  assessor      : Assessor
+  findings      : String              default ""
+  status        : AssessmentStatus    default PENDING
+  started_at    : DateTime?
+  completed_at  : DateTime?
 }
 
 entity Payout {
-  payout_id: String  key
-  claim: Claim
-  amount_pence: Integer
-  status: PayoutStatus               default: scheduled
-  scheduled_at: DateTime             default: now()
-  paid_at: DateTime?                 default: null
-  failed_attempts: Integer           default: 0
-  last_failure_at: DateTime?         default: null
+  payout_id        : String        identity
+  claim            : Claim
+  amount_pence     : Integer
+  status           : PayoutStatus  default SCHEDULED
+  scheduled_at     : DateTime      default now()
+  paid_at          : DateTime?
+  failed_attempts  : Integer       default 0
+  last_failure_at  : DateTime?
 }
 
-# ---------------------------------------------------------------------------
-# External entity — owned by upstream feeds (police, medical assessors)
-# ---------------------------------------------------------------------------
-
+-- External entity: pushed in by police / medical feeds via webhook.
+-- Lifecycle is not owned by this system; we only receive and link.
 external entity IncidentReport {
-  report_id: String  key
-  source: String                     # e.g. "police", "medical"
-  policy: Policy?                    # may arrive without a known policy
-  incident_date: DateTime
-  description: String
-  received_at: DateTime              default: now()
-  linked_claim: Claim?               default: null
+  report_id            : String     identity
+  source               : String                     -- e.g. "police", "medical"
+  policy_number        : String?
+  incident_date        : DateTime
+  description          : String
+  received_at          : DateTime   default now()
+  linked_claim         : Claim?
 }
 
-# ---------------------------------------------------------------------------
-# Claim lifecycle — state machine
-# ---------------------------------------------------------------------------
+-- =========================================================================
+-- Registration triggers (setup)
+-- =========================================================================
 
-state_machine Claim.status {
-  initial: submitted
+trigger register_policy(
+  policy_number        : String,
+  holder               : String,
+  coverage_limit_pence : Integer,
+  holder_tags          : Set<String> = {},
+) {
+  create Policy {
+    policy_number        = policy_number,
+    holder               = holder,
+    coverage_limit_pence = coverage_limit_pence,
+    holder_tags          = holder_tags,
+    status               = ACTIVE,
+  }
+}
 
-  transition submit
-    to: submitted
-    actor: adjuster_api
-    surface: POST /claims
-    creates: Claim
-    requires:
-      Policy exists with policy_number == input.policy_number
-      Policy.status == active
-      input.amount_claimed_pence <= Policy.coverage_limit_pence
-    on_failure: ClaimRejected
+trigger register_assessor(name : String, specialties : Set<String>) {
+  create Assessor { name = name, specialties = specialties }
+}
 
-  transition triage
-    from: submitted
-    to: triaged
-    actors: [adjuster_api, auto_acknowledge_job]
-    surface: POST /claims/<claim_number>/triage
-    effect: touch(last_activity_at)
-    on_invalid_state: InvalidTransition
+-- =========================================================================
+-- Claim state machine — guarded transitions
+-- =========================================================================
 
-  transition start_assessment
-    from: triaged
-    to: assessing
-    actor: adjuster_api
-    surface: POST /claims/<claim_number>/assess
-    requires:
-      Assessor exists with name == input.assessor_name
-    effect:
-      create Assessment {
-        status: in_progress,
-        started_at: now(),
-        assessor: input.assessor_name,
-        claim: self
-      }
-      touch(last_activity_at)
-    on_invalid_state: InvalidTransition
-    on_unknown_assessor: ClaimRejected
-
-  transition approve
-    from: assessing
-    to: approved
-    actors: [adjuster_api, auto_approval_scheduler]
-    surface: POST /claims/<claim_number>/approve
-    guard:
-      exists(Assessment a
-        where a.claim == self
-          and a.status == completed)
-    effect: touch(last_activity_at)
-    on_invalid_state: InvalidTransition
-    on_missing_assessment: InvalidTransition
+trigger submit_claim(
+  claim_number         : String,
+  policy_number        : String,
+  incident_date        : DateTime,
+  amount_claimed_pence : Integer,
+) {
+  let policy = Policy[policy_number]
+    or reject "unknown policy {policy_number}"
 
-  transition deny
-    from: {triaged, assessing}
-    to: denied
-    actor: adjuster_api
-    surface: POST /claims/<claim_number>/deny
-    effect:
-      set denial_reason = input.reason
-      touch(last_activity_at)
-    on_invalid_state: InvalidTransition
+  require policy.status == ACTIVE
+    else reject "policy {policy_number} is {policy.status}"
 
-  transition mark_paid_via_payout
-    from: approved
-    to: paid
-    trigger: Payout.status -> paid
-    effect: touch(last_activity_at)
+  require amount_claimed_pence <= policy.coverage_limit_pence
+    else reject "amount claimed exceeds coverage limit"
 
-  transition auto_close
-    from: denied
-    to: closed
-    actor: auto_close_denied_job
-    requires: (now() - last_activity_at) >= AUTO_CLOSE_DENIED_AFTER
-    effect: touch(last_activity_at)
+  create Claim {
+    claim_number         = claim_number,
+    policy               = policy,
+    incident_date        = incident_date,
+    amount_claimed_pence = amount_claimed_pence,
+    status               = SUBMITTED,
+  }
 }
 
-# ---------------------------------------------------------------------------
-# Assessment lifecycle
-# ---------------------------------------------------------------------------
+trigger triage(claim : Claim) {
+  require claim.status == SUBMITTED
+    else invalid_transition
 
-state_machine Assessment.status {
-  initial: pending
+  claim.status           := TRIAGED
+  claim.last_activity_at := now()
+}
 
-  transition begin
-    from: pending
-    to: in_progress
-    trigger: Claim.start_assessment
-    effect: set started_at = now()
+trigger start_assessment(claim : Claim, assessor : Assessor) {
+  require claim.status == TRIAGED
+    else invalid_transition
+  require assessor exists in Assessor
+    else reject "unknown assessor"
 
-  transition complete
-    from: in_progress
-    to: completed
-    actor: assessor_api
-    requires: input.findings provided
-    effect:
-      set findings = input.findings
-      set completed_at = now()
-      touch(claim.last_activity_at)
-    on_invalid_state: InvalidTransition
-    on_unknown_assessment: ClaimRejected
+  create Assessment {
+    claim       = claim,
+    assessor    = assessor,
+    status      = IN_PROGRESS,
+    started_at  = now(),
+  }
+  claim.status           := ASSESSING
+  claim.last_activity_at := now()
 }
 
-# ---------------------------------------------------------------------------
-# Payout lifecycle
-# ---------------------------------------------------------------------------
+trigger complete_assessment(assessment : Assessment, findings : String) {
+  require assessment.status == IN_PROGRESS
+    else invalid_transition
 
-state_machine Payout.status {
-  initial: scheduled
+  assessment.findings     := findings
+  assessment.status       := COMPLETED
+  assessment.completed_at := now()
+  assessment.claim.last_activity_at := now()
+}
 
-  transition schedule
-    to: scheduled
-    creates: Payout
-    trigger: Claim.approve  (chained from approve_claim_route + auto_approval_scheduler)
-    requires: Claim.status == approved
-    effect:
-      set amount_pence = claim.amount_claimed_pence
-      set scheduled_at = now()
-      touch(claim.last_activity_at)
-    on_invalid_claim_state: InvalidTransition
+-- Guarded transition: requires ASSESSING *and* a completed Assessment.
+-- Called from both the adjuster API and the auto-approval scheduler.
+trigger approve_claim(claim : Claim) {
+  require claim.status == ASSESSING
+    else invalid_transition
+  require exists a in Assessment
+            where a.claim == claim and a.status == COMPLETED
+    else invalid_transition "claim has no completed assessment"
 
-  transition mark_paid
-    from: {scheduled, failed}
-    to: paid
-    actors: [adjuster_api, payout_retry_job]
-    surface: POST /payouts/<payout_id>/mark-paid
-    effect:
-      set paid_at = now()
-      cascade Claim.status = paid
-      touch(claim.last_activity_at)
-    on_unknown_payout: ClaimRejected
+  claim.status           := APPROVED
+  claim.last_activity_at := now()
+}
 
-  transition mark_failed
-    from: scheduled
-    to: failed
-    actor: payout_retry_job
-    on_payment_error: true
-    effect:
-      increment failed_attempts
-      set last_failure_at = now()
+trigger deny_claim(claim : Claim, reason : String) {
+  require claim.status in { TRIAGED, ASSESSING }
+    else invalid_transition
 
-  transition retry_after_failure
-    from: failed
-    to: failed | paid
-    actor: payout_retry_job
-    requires:
-      (now() - coalesce(last_failure_at, scheduled_at)) >= PAYOUT_RETRY_AFTER
-    effect:
-      call faster_payments.send_faster_payment(...)
-      on_success: transition mark_paid
-      on_PaymentError: transition mark_failed
+  claim.status           := DENIED
+  claim.denial_reason    := reason
+  claim.last_activity_at := now()
 }
 
-# ---------------------------------------------------------------------------
-# Temporal / scheduled jobs
-# ---------------------------------------------------------------------------
+trigger schedule_payout(claim : Claim) -> Payout {
+  require claim.status == APPROVED
+    else invalid_transition
 
-job auto_acknowledge_job {
-  description:
-    "Auto-triage claims that have been SUBMITTED for >= 5 business days."
-  selects: Claim where status == submitted
-  guard:
-    business_days_between(claim.submitted_at, now()) >= AUTO_ACK_AFTER_BUSINESS_DAYS
-  action: Claim.triage(claim)
-  returns: List<claim_number>
+  let payout = create Payout {
+    claim         = claim,
+    amount_pence  = claim.amount_claimed_pence,
+    status        = SCHEDULED,
+  }
+  claim.last_activity_at := now()
+  return payout
 }
 
-job assessment_sla_job {
-  description:
-    "Surface claims that have breached the 14-day assessment SLA."
-  selects: Claim where status in {triaged, assessing}
-  guard: (now() - claim.submitted_at) > ASSESSMENT_SLA
-  action: report breached
-  returns: List<claim_number>
+trigger mark_payout_paid(payout : Payout) {
+  payout.status   := PAID
+  payout.paid_at  := now()
+  payout.claim.status           := PAID
+  payout.claim.last_activity_at := now()
 }
 
-job payout_retry_job {
-  description:
-    "Retry FAILED payouts older than the retry threshold via Faster Payments."
-  selects: Payout where status == failed
-  guard:
-    (now() - coalesce(payout.last_failure_at, payout.scheduled_at))
-      >= PAYOUT_RETRY_AFTER
-  action:
-    try faster_payments.send_faster_payment(
-      account_number: "00000000",
-      sort_code:      "00-00-00",
-      amount_pence:   payout.amount_pence,
-      reference:      payout.payout_id)
-    on_success: Payout.mark_paid(payout)
-    on_PaymentError: Payout.mark_failed(payout)
-  returns: List<payout_id>          # successful retries only
+trigger mark_payout_failed(payout : Payout) {
+  payout.status           := FAILED
+  payout.failed_attempts  := payout.failed_attempts + 1
+  payout.last_failure_at  := now()
 }
 
-job auto_close_denied_job {
-  description:
-    "Close DENIED claims that have had no activity for 90 days."
-  selects: Claim where status == denied
-  guard: (now() - claim.last_activity_at) >= AUTO_CLOSE_DENIED_AFTER
-  action:
-    set status = closed
-    touch(last_activity_at)
-  returns: List<claim_number>
+-- Composite trigger fired by the adjuster API's POST /claims/{n}/approve.
+trigger adjuster_approve(claim : Claim) -> Payout {
+  apply approve_claim(claim)
+  return apply schedule_payout(claim)
 }
 
-job auto_approval_scheduler {
-  description:
-    "Auto-approve low-value claims for trusted holders once assessed —
-     a second call site for Claim.approve alongside the adjuster API."
-  selects: Claim
-  guard:
-    claim.status == assessing
-    and claim.amount_claimed_pence < AUTO_APPROVE_MAX_PENCE
-    and exists(Assessment a
-                where a.claim == claim
-                  and a.status == completed)
-    and claim.policy != null
-    and "trusted" in claim.policy.holder_tags
-  action: Claim.approve(claim)       # cascades to Payout.schedule via route logic? no — see note
-  returns: List<claim_number>
+-- =========================================================================
+-- Temporal / scheduled rules
+-- =========================================================================
 
-  note:
-    Unlike the HTTP /approve route, this scheduler does NOT schedule a Payout —
-    it only calls approve_claim(). Payout scheduling for these auto-approved
-    claims is therefore not performed automatically inside the job; the only
-    code path that follows approve_claim with schedule_payout is the
-    adjuster-facing route. This asymmetry is observable and intentional in
-    the implementation (jobs.py:121).
+-- Auto-acknowledge anything sat in SUBMITTED for >= 5 business days.
+rule auto_acknowledge schedule daily {
+  for claim in Claim
+  where claim.status == SUBMITTED
+    and business_days_between(claim.submitted_at, now()) >= 5
+  apply triage(claim)
 }
 
-# ---------------------------------------------------------------------------
-# HTTP surface (adjuster-facing API)
-# ---------------------------------------------------------------------------
+-- Surface claims that have breached the 14-day assessment SLA. Read-only:
+-- the rule emits a signal; the claim itself is not mutated.
+rule assessment_sla_breach schedule daily {
+  for claim in Claim
+  where claim.status in { TRIAGED, ASSESSING }
+    and (now() - claim.submitted_at) > ASSESSMENT_SLA
+  emit sla_breached(claim)
+}
 
-surface adjuster_api {
-  protocol: HTTP
+-- Retry FAILED payouts after 28 days. The retry anchor prefers
+-- last_failure_at, falling back to scheduled_at.
+rule payout_retry schedule daily {
+  for payout in Payout
+  where payout.status == PayoutStatus.FAILED
+    and (now() - coalesce(payout.last_failure_at, payout.scheduled_at))
+         >= PAYOUT_RETRY_AFTER
+  do {
+    try {
+      PaymentClient.send_faster_payment(
+        account_number = "00000000",
+        sort_code      = "00-00-00",
+        amount_pence   = payout.amount_pence,
+        reference      = payout.payout_id,
+      )
+      apply mark_payout_paid(payout)
+    } catch PaymentError {
+      apply mark_payout_failed(payout)
+    }
+  }
+}
 
-  route POST /claims
-    handler: submit_claim
-    body: {claim_number, policy_number, incident_date, amount_claimed_pence}
-    returns: {claim_number, status}
-    errors:
-      ClaimRejected: unknown policy / inactive policy / amount > coverage_limit
+-- Auto-close DENIED claims that have had no activity for 90 days.
+rule auto_close_denied schedule daily {
+  for claim in Claim
+  where claim.status == DENIED
+    and (now() - claim.last_activity_at) >= AUTO_CLOSE_DENIED_AFTER
+  do {
+    claim.status           := CLOSED
+    claim.last_activity_at := now()
+  }
+}
 
-  route POST /claims/<claim_number>/triage
-    handler: triage_claim
-    returns: {claim_number, status}
-    errors:
-      ClaimRejected: unknown claim
-      InvalidTransition: status != submitted
+-- Auto-approve low-value, trusted-holder claims with a completed
+-- assessment. Also calls approve_claim(); the guard on approve_claim
+-- still applies.
+rule auto_approval_scheduler schedule daily {
+  for claim in Claim
+  where claim.status == ASSESSING
+    and claim.amount_claimed_pence < AUTO_APPROVE_MAX_PENCE
+    and "trusted" in claim.policy.holder_tags
+    and exists a in Assessment
+              where a.claim == claim and a.status == COMPLETED
+  apply approve_claim(claim)
+}
 
-  route POST /claims/<claim_number>/assess
-    handler: start_assessment
-    body: {assessor_name}
-    returns: {assessment_id, claim_number, assessor_name}
-    errors:
-      ClaimRejected: unknown claim / unknown assessor
-      InvalidTransition: status != triaged
+-- =========================================================================
+-- Surfaces — adjuster-facing HTTP API
+-- =========================================================================
 
-  route POST /claims/<claim_number>/approve
-    handler: approve_claim then schedule_payout
-    returns: {claim_number, status, payout_id}
-    errors:
-      ClaimRejected: unknown claim
-      InvalidTransition: status != assessing or no completed assessment
+surface AdjusterAPI {
 
-  route POST /claims/<claim_number>/deny
-    handler: deny_claim
-    body: {reason}
-    returns: {claim_number, status, denial_reason}
-    errors:
-      ClaimRejected: unknown claim
-      InvalidTransition: status not in {triaged, assessing}
+  POST /claims
+    body { claim_number, policy_number, incident_date, amount_claimed_pence }
+    -> apply submit_claim(...)
+    response { claim_number, status }
 
-  route POST /payouts/<payout_id>/mark-paid
-    handler: mark_payout_paid
-    returns: {payout_id, status}
-    side_effect: cascade Claim.status -> paid
-    errors:
-      ClaimRejected: unknown payout
+  POST /claims/{claim_number}/triage
+    -> apply triage(Claim[claim_number])
+    response { claim_number, status }
 
-  route GET /policies/<policy_number>/claims
-    handler: list_policy_claims
-    returns: List<{claim_number, status, amount_claimed_pence,
-                   is_within_sla, is_stalled}>
+  POST /claims/{claim_number}/assess
+    body { assessor_name }
+    -> apply start_assessment(Claim[claim_number], Assessor[assessor_name])
+    response { assessment_id, claim_number, assessor_name }
 
-  route GET /claims/<claim_number>
-    handler: get_claim
-    returns:
-      {claim_number, policy_number, status, amount_claimed_pence,
-       total_paid_pence, is_within_sla, is_stalled, closed}
-}
+  POST /claims/{claim_number}/approve
+    -> apply adjuster_approve(Claim[claim_number])
+    response { claim_number, status, payout_id }
 
-# ---------------------------------------------------------------------------
-# Inbound webhook surface
-# ---------------------------------------------------------------------------
+  POST /claims/{claim_number}/deny
+    body { reason }
+    -> apply deny_claim(Claim[claim_number], reason)
+    response { claim_number, status, denial_reason }
 
-surface incident_webhook {
-  protocol: HTTP
+  POST /payouts/{payout_id}/mark-paid
+    -> apply mark_payout_paid(Payout[payout_id])
+    response { payout_id, status }
 
-  route POST /webhooks/incident-reports
-    handler: receive_incident_report
-    body: {source, policy_number?, incident_date, description}
-    effect:
-      create IncidentReport {
-        report_id: uuid(),
-        received_at: now(),
-        linked_claim_number: try_link(report)
-      }
-    returns: {report_id, linked_claim_number}
+  GET /policies/{policy_number}/claims
+    -> [ { claim_number, status, amount_claimed_pence,
+           is_within_sla, is_stalled }
+         for c in Claim where c.policy.policy_number == policy_number ]
 
-  rule try_link_incident_report:
-    given an IncidentReport r with r.policy_number != null,
-    set r.linked_claim_number to the claim_number of the first Claim c such that
-      c.policy_number == r.policy_number
-      and abs(c.incident_date - r.incident_date) <= INCIDENT_LINK_WINDOW
-    otherwise leave r.linked_claim_number = null
+  GET /claims/{claim_number}
+    -> { claim_number, policy_number, status, amount_claimed_pence,
+         total_paid_pence: claim.total_paid_pence,
+         is_within_sla, is_stalled, closed }
 }
 
-# ---------------------------------------------------------------------------
-# Third-party integrations
-# ---------------------------------------------------------------------------
+-- =========================================================================
+-- Surfaces — inbound webhooks
+-- =========================================================================
 
-integration faster_payments {
-  vendor: "Faster Payments (bank API)"
-  ownership: external                  # contract owned upstream, not by us
+surface IncidentWebhook {
 
-  operation send_faster_payment {
-    request {
-      account_number: String           # exactly 8 digits
-      sort_code: String                # NN-NN-NN
-      amount_pence: Integer            # > 0 and <= FASTER_PAYMENTS_UPSTREAM_CAP_PENCE
-      reference: String                # appears on recipient statement
-    }
-    response PaymentResult {
-      request: PaymentRequest
-      status: PaymentResultStatus      # accepted | rejected | pending_review
-      upstream_id: String              # "fp-<reference>"
-      submitted_at: DateTime
-    }
-    validation_errors -> PaymentError:
-      amount_pence <= 0
-      length(account_number) != 8 or not all-digits
-      sort_code not matching NN-NN-NN
-      amount_pence > FASTER_PAYMENTS_UPSTREAM_CAP_PENCE
+  POST /webhooks/incident-reports
+    body { source, policy_number?, incident_date, description }
+    -> apply receive_incident_report(...)
+    response { report_id, linked_claim_number }
+}
+
+trigger receive_incident_report(
+  source        : String,
+  policy_number : String?,
+  incident_date : DateTime,
+  description   : String,
+) -> IncidentReport {
+  let report = create IncidentReport {
+    source        = source,
+    policy_number = policy_number,
+    incident_date = incident_date,
+    description   = description,
   }
+  apply try_link_incident_report(report)
+  return report
+}
 
-  used_by: payout_retry_job
+-- Best-effort linkage by (policy_number, incident_date ± 2 days).
+-- No-op if policy_number is null or no claim matches the window.
+trigger try_link_incident_report(report : IncidentReport) {
+  when report.policy_number != null
+
+  let candidate = first c in Claim
+    where c.policy.policy_number == report.policy_number
+      and abs(c.incident_date - report.incident_date) <= INCIDENT_LINK_WINDOW
+
+  when candidate != null
+    report.linked_claim := candidate
 }
 
-integration assessor_network {
-  vendor: "Assessor dispatch network"
-  ownership: external
+-- =========================================================================
+-- Third-party contracts (library specs — owned by the vendor)
+-- =========================================================================
 
-  operation request_assessor_dispatch {
-    request {
-      claim_number: String
-      specialties: List<String>        # must be non-empty
-    }
-    response AssessorDispatch {
-      dispatch_id: String              # "disp-<8hex>"
-      claim_number: String
-      specialties: List<String>
-    }
-    validation_errors -> AssessorDispatchError:
-      specialties is empty
+-- Faster-Payments-shaped bank API. The contract belongs to the bank; we only
+-- consume it.
+contract PaymentClient {
+
+  enum PaymentResultStatus { ACCEPTED, REJECTED, PENDING_REVIEW }
+
+  type PaymentRequest {
+    account_number : String     -- 8 digits, "^[0-9]{8}$"
+    sort_code      : String     -- "NN-NN-NN", "^[0-9]{2}-[0-9]{2}-[0-9]{2}$"
+    amount_pence   : Integer
+    reference      : String     -- appears on recipient's statement
   }
-}
 
-# ---------------------------------------------------------------------------
-# Cross-cutting rules / invariants
-# ---------------------------------------------------------------------------
+  type PaymentResult {
+    request       : PaymentRequest
+    status        : PaymentResultStatus
+    upstream_id   : String
+    submitted_at  : DateTime
+  }
 
-rule claim_amount_bounded_by_policy:
-  for every Claim c:
-    c.amount_claimed_pence <= c.policy.coverage_limit_pence
-  enforced_at: Claim.submit
+  error PaymentError
 
-rule claim_only_against_active_policy:
-  for every newly submitted Claim c:
-    c.policy.status == active
-  enforced_at: Claim.submit
+  operation send_faster_payment(
+    account_number : String,
+    sort_code      : String,
+    amount_pence   : Integer,
+    reference      : String,
+  ) -> PaymentResult
+    raises PaymentError
 
-rule approve_requires_completed_assessment:
-  for every Claim.approve transition:
-    exists(Assessment a where a.claim == claim and a.status == completed)
-  enforced_at: Claim.approve
+    precondition amount_pence > 0
+      else PaymentError "amount must be positive"
+    precondition account_number matches /^[0-9]{8}$/
+      else PaymentError "account_number must be 8 digits"
+    precondition sort_code matches /^[0-9]{2}-[0-9]{2}-[0-9]{2}$/
+      else PaymentError "sort_code must be in NN-NN-NN format"
+    precondition amount_pence <= 100_000_000     -- £1,000,000 upstream cap
+      else PaymentError "upstream caps Faster Payments at £1,000,000"
 
-rule payout_amount_matches_claim:
-  for every Payout p created via Claim.approve:
-    p.amount_pence == p.claim.amount_claimed_pence
-  enforced_at: Payout.schedule
+    postcondition result.status == ACCEPTED
+      and result.upstream_id == "fp-" ++ reference
+}
 
-rule paid_payout_marks_claim_paid:
-  for every Payout p transitioning to paid:
-    p.claim.status becomes paid
-  enforced_at: Payout.mark_paid
+-- External assessor-network dispatch endpoint.
+contract AssessorNetwork {
 
-rule failed_payout_increments_counter:
-  for every Payout p transitioning to failed:
-    p.failed_attempts increases by 1
-    p.last_failure_at == now()
-  enforced_at: Payout.mark_failed
+  type AssessorDispatch {
+    dispatch_id   : String     -- "disp-<8 hex chars>"
+    claim_number  : String
+    specialties   : List<String>
+  }
 
-rule stalled_is_derived_not_stored:
-  Claim.is_stalled is computed from (status, last_activity_at);
-  there is no persisted `stalled` field on Claim.
-  source_of_truth: derived
+  error AssessorDispatchError
 
-rule sla_breach_is_observation_only:
-  assessment_sla_job lists breached claims but does NOT mutate them;
-  SLA breach has no effect on status.
+  operation request_assessor_dispatch(
+    claim_number : String,
+    specialties  : List<String>,
+  ) -> AssessorDispatch
+    raises AssessorDispatchError
 
-rule auto_approval_scope:
-  auto_approval_scheduler only approves Claim c where
-    c.status == assessing
-    and c.amount_claimed_pence < AUTO_APPROVE_MAX_PENCE
-    and exists completed Assessment for c
-    and c.policy.holder_tags contains "trusted".
+    precondition specialties is non_empty
+      else AssessorDispatchError "at least one specialty is required"
+}
 
-rule incident_link_window:
-  IncidentReport r links to Claim c only when
-    r.policy_number == c.policy_number
-    and abs(r.incident_date - c.incident_date) <= INCIDENT_LINK_WINDOW.
-  Reports with policy_number == null are stored but never linked.
+-- =========================================================================
+-- Invariants
+-- =========================================================================
 
-rule closed_statuses:
-  the set of "closed" Claim statuses is {paid, denied, closed};
-  Policy.has_open_claims excludes these.
+invariant approval_requires_completed_assessment {
+  for claim in Claim where claim.status in { APPROVED, PAID }
+  exists a in Assessment where a.claim == claim and a.status == COMPLETED
+}
 
-# ---------------------------------------------------------------------------
-# Actors
-# ---------------------------------------------------------------------------
+invariant payout_only_for_approved_or_later {
+  for payout in Payout
+  payout.claim.status in { APPROVED, PAID }
+}
 
-actor adjuster_api          # human adjusters via HTTP
-actor auto_acknowledge_job
-actor assessment_sla_job
-actor payout_retry_job
-actor auto_close_denied_job
-actor auto_approval_scheduler
-actor incident_feed         # external — police, medical
-actor assessor_api          # completes assessments
+invariant payout_amount_matches_claim_at_schedule_time {
+  for payout in Payout
+  payout.amount_pence == payout.claim.amount_claimed_pence
+}
 
-# ---------------------------------------------------------------------------
-# Errors raised by the service layer
-# ---------------------------------------------------------------------------
+invariant denial_reason_iff_denied {
+  for claim in Claim
+  (claim.status == DENIED) iff (claim.denial_reason != null)
+}
 
-error ClaimRejected         # input refers to unknown entity, or business rejection
-error InvalidTransition     # status guard failed for a state-machine transition
-error PaymentError          # raised by faster_payments integration
-error AssessorDispatchError # raised by assessor_network integration
+invariant terminal_states_immutable {
+  for claim in Claim where claim.status in { PAID, CLOSED }
+  no trigger may change claim.status
+}
+
+invariant denied_only_transitions_to_closed {
+  for claim in Claim where claim.status == DENIED
+  the only permitted next status is CLOSED (via auto_close_denied)
+}
+
+invariant claim_amount_within_coverage_at_submit {
+  for claim in Claim
+  claim.amount_claimed_pence <= claim.policy.coverage_limit_pence
+}
+
+invariant stalled_is_derived_not_stored {
+  Claim has no field `stalled`
+  -- is_stalled is computed from (status == ASSESSING, last_activity_at, STALLED_AFTER)
+}
+
+invariant incident_link_window {
+  for report in IncidentReport where report.linked_claim != null
+  report.linked_claim.policy.policy_number == report.policy_number
+    and abs(report.linked_claim.incident_date - report.incident_date)
+        <= INCIDENT_LINK_WINDOW
+}
```

