# A/B harness report

- results dir: `/Users/yavorpanayotov/IdeaProjects/allium-4.0/eval/results/2026-05-16T10-07-44-715Z`
- started: 2026-05-16T10:07:44.715Z
- model: (user default)
- prompt hash: `9b1692cd`

## Per-variant summary

### baseline (1 samples)

- `allium check` pass: **0/1**
- structural counts: _entities/fields from `allium model`; rule-likes & others from text regex_
- entity-like (entity / external entity / variant) median: **6** — per-sample: 6
- rule-like (rule / trigger / invariant) median: **5** — per-sample: 5
- field count (median): **26** — per-sample: 26
- other top-level constructs (totals across samples): contract=2, enum=6, job=5, state_machine=3, surface=2
- only one sample — no determinism data

  - sample-1: FAIL (317E / 6W / 43I)
    - error@61:1: expected declaration (entity, rule, enum, value, config, surface, actor, given, 
    - error@62:1: expected declaration (entity, rule, enum, value, config, surface, actor, given, 
    - error@63:1: expected declaration (entity, rule, enum, value, config, surface, actor, given, 
    - … and 363 more

### experimental (1 samples)

- `allium check` pass: **0/1**
- structural counts: _entities/fields from `allium model`; rule-likes & others from text regex_
- entity-like (entity / external entity / variant) median: **6** — per-sample: 6
- rule-like (rule / trigger / invariant) median: **9** — per-sample: 9
- field count (median): **32** — per-sample: 32
- other top-level constructs (totals across samples): contract=2, enum=6, surface=2
- only one sample — no determinism data

  - sample-1: FAIL (228E / 2W / 30I)
    - error@57:1: expected declaration (entity, rule, enum, value, config, surface, actor, given, 
    - error@58:1: expected declaration (entity, rule, enum, value, config, surface, actor, given, 
    - error@59:1: expected declaration (entity, rule, enum, value, config, surface, actor, given, 
    - … and 257 more

## Inter-variant diff: baseline/sample-1 vs experimental/sample-1

### Structural

- entities: Jaccard 1.00

- rules: Jaccard 0.00
  - only in A: ClaimAmountWithinCoverage, DeniedClaimsHaveReason, PaidPayoutHasTimestamp, FailedPayoutHasFailureAttempt, CompletedAssessmentHasTimestamp
  - only in B: auto_acknowledge_submitted, flag_assessment_sla_breach, retry_failed_payouts, auto_close_denied_claims, auto_approve_low_value_trusted_claims, stalled_signal_is_derived, payment_amount_matches_claim, payout_cascade_to_claim, link_incident_to_claim

- field-count delta: 6 (baseline=26, experimental=32)

### Unified text diff

```diff
--- /Users/yavorpanayotov/IdeaProjects/allium-4.0/eval/results/2026-05-16T10-07-44-715Z/baseline/sample-1/spec.allium	2026-05-16 13:10:23
+++ /Users/yavorpanayotov/IdeaProjects/allium-4.0/eval/results/2026-05-16T10-07-44-715Z/experimental/sample-1/spec.allium	2026-05-16 13:17:00
@@ -1,434 +1,408 @@
 -- allium: 3
 
--- ============================================================================
--- Insurance Claims Processing System
---
--- An adjuster-facing service that submits, triages, assesses, approves,
--- denies, pays out and closes insurance claims. Receives external incident
--- reports via webhook, dispatches assessors and sends payments through
--- third-party integrations.
--- ============================================================================
+-- Insurance claims processing service.
+-- A small web service that submits, triages, assesses, approves, denies
+-- and pays out on insurance claims. State is held in an in-memory Store
+-- (Policy / Claim / Assessor / Assessment / Payout / IncidentReport).
+-- IncidentReport is an *external* entity that arrives via webhook from
+-- police and medical feeds; the app does not own its lifecycle.
 
-
--- ---------------------------------------------------------------------------
+-- ============================================================
 -- Status enums
--- ---------------------------------------------------------------------------
+-- ============================================================
 
 enum PolicyStatus {
-  active
-  lapsed
-  cancelled
+  ACTIVE
+  LAPSED
+  CANCELLED
 }
 
 enum ClaimStatus {
-  submitted
-  triaged
-  assessing
-  approved
-  denied
-  paid
-  closed
+  SUBMITTED
+  TRIAGED
+  ASSESSING
+  APPROVED
+  DENIED
+  PAID
+  CLOSED
 }
 
 enum AssessmentStatus {
-  pending
-  in_progress
-  completed
+  PENDING
+  IN_PROGRESS
+  COMPLETED
 }
 
 enum PayoutStatus {
-  scheduled
-  paid
-  failed
+  SCHEDULED
+  PAID
+  FAILED
 }
 
-enum IncidentSource {
-  police
-  medical
+enum PaymentResultStatus {
+  ACCEPTED
+  REJECTED
+  PENDING_REVIEW
 }
 
-enum PaymentResultStatus {
-  accepted
-  rejected
-  pending_review
+enum IncidentSource {
+  POLICE
+  MEDICAL
 }
 
-
--- ---------------------------------------------------------------------------
+-- ============================================================
 -- Temporal constants
--- ---------------------------------------------------------------------------
+-- ============================================================
 
-const ASSESSMENT_SLA: Duration = 14 days
-const STALLED_AFTER: Duration = 21 days
-const AUTO_ACK_AFTER: Duration = 5 business_days
-const PAYOUT_RETRY_AFTER: Duration = 28 days
-const AUTO_CLOSE_DENIED_AFTER: Duration = 90 days
-const INCIDENT_LINK_WINDOW: Duration = 2 days
-const AUTO_APPROVE_MAX_PENCE: Integer = 5_000_000  -- £50,000
-const FASTER_PAYMENT_UPSTREAM_CAP_PENCE: Integer = 100_000_000  -- £1,000,000
+constant STALLED_AFTER : Duration = 21 days
+constant ASSESSMENT_SLA : Duration = 14 days
+constant AUTO_ACK_AFTER : Duration = 5 business_days
+constant PAYOUT_RETRY_AFTER : Duration = 28 days
+constant AUTO_CLOSE_DENIED_AFTER : Duration = 90 days
+constant INCIDENT_LINK_WINDOW : Duration = 2 days
+constant AUTO_APPROVE_MAX_PENCE : Money = 50_000_00
+constant UPSTREAM_FASTER_PAYMENTS_CAP_PENCE : Money = 1_000_000_00
 
+-- ============================================================
+-- Core entities
+-- ============================================================
 
--- ---------------------------------------------------------------------------
--- Entities
--- ---------------------------------------------------------------------------
-
 entity Policy {
-  policy_number: String  (identity)
-  holder: String
-  coverage_limit_pence: Integer
-  status: PolicyStatus = active
-  holder_tags: Set<String> = {}
+  policy_number       : ID
+  holder              : String
+  coverage_limit_pence: Money
+  status              : PolicyStatus = ACTIVE
+  holder_tags         : Set<String>
 
-  derived has_open_claims: Boolean =
-    exists Claim c
-    where c.policy == this
-      and c.status not in {paid, denied, closed}
-
-  derived is_trusted_holder: Boolean = "trusted" in holder_tags
+  derived has_open_claims : Boolean =
+    exists c in Claim where
+      c.policy = self and
+      c.status not in { PAID, DENIED, CLOSED }
 }
 
 entity Claim {
-  claim_number: String  (identity)
-  policy: Policy                            -- FK by policy_number
-  incident_date: DateTime
-  amount_claimed_pence: Integer
-  submitted_at: DateTime = now()
-  last_activity_at: DateTime = now()
-  status: ClaimStatus = submitted
-  denial_reason: String?
+  claim_number          : ID
+  policy                : Policy           -- FK: stored as policy_number in code
+  incident_date         : DateTime
+  amount_claimed_pence  : Money
+  submitted_at          : DateTime         -- defaults to now() on creation
+  last_activity_at      : DateTime         -- bumped on every state change ("touch")
+  status                : ClaimStatus = SUBMITTED
+  denial_reason         : String?
 
-  derived age: Duration = now() - submitted_at
+  derived age : Duration = now() - submitted_at
 
-  derived is_within_sla: Boolean = age <= ASSESSMENT_SLA
+  derived is_within_sla : Boolean = age <= ASSESSMENT_SLA
 
-  -- Implicit state: there is deliberately no `stalled` column. Derived from
-  -- (status, last_activity_at).
-  derived is_stalled: Boolean =
-    status == assessing
-    and (now() - last_activity_at) > STALLED_AFTER
+  -- Implicit state machine: there is deliberately NO `stalled` column.
+  -- Computed from (status, last_activity_at) on every read.
+  derived is_stalled : Boolean =
+    status = ASSESSING and
+    (now() - last_activity_at) > STALLED_AFTER
 
-  derived total_paid_pence: Integer =
-    sum p.amount_pence
-    over Payout p
-    where p.claim == this and p.status == paid
+  derived total_paid_pence : Money =
+    sum p.amount_pence over p in Payout
+      where p.claim = self and p.status = PAID
 
-  derived closed: Boolean = status in {paid, denied, closed}
+  derived closed : Boolean = status in { PAID, DENIED, CLOSED }
 }
 
 entity Assessor {
-  name: String  (identity)
-  specialties: Set<String> = {}
+  name        : ID
+  specialties : Set<String>
 }
 
 entity Assessment {
-  assessment_id: String  (identity)
-  claim: Claim
-  assessor: Assessor
-  findings: String = ""
-  status: AssessmentStatus = pending
-  started_at: DateTime?
-  completed_at: DateTime?
+  assessment_id : ID
+  claim         : Claim
+  assessor      : Assessor
+  findings      : String = ""
+  status        : AssessmentStatus = PENDING
+  started_at    : DateTime?
+  completed_at  : DateTime?
 }
 
 entity Payout {
-  payout_id: String  (identity)
-  claim: Claim
-  amount_pence: Integer
-  status: PayoutStatus = scheduled
-  scheduled_at: DateTime = now()
-  paid_at: DateTime?
-  failed_attempts: Integer = 0
-  last_failure_at: DateTime?
+  payout_id        : ID
+  claim            : Claim
+  amount_pence     : Money
+  status           : PayoutStatus = SCHEDULED
+  scheduled_at     : DateTime        -- defaults to now() on creation
+  paid_at          : DateTime?
+  failed_attempts  : Int = 0
+  last_failure_at  : DateTime?
 }
 
--- External entity: arrives over the webhook surface, lifecycle owned upstream.
+-- ============================================================
+-- External entity (lifecycle owned by upstream feeds)
+-- ============================================================
+
 external entity IncidentReport {
-  report_id: String  (identity)
-  source: String                            -- e.g. "police", "medical"
-  policy_number: String?
-  incident_date: DateTime
-  description: String
-  received_at: DateTime = now()
-  linked_claim: Claim?
+  report_id           : ID
+  source              : IncidentSource     -- "police" | "medical"
+  policy_number       : String?            -- optional; webhook may omit
+  incident_date       : DateTime
+  description         : String
+  received_at         : DateTime           -- defaults to now() on receipt
+  linked_claim        : Claim?             -- resolved on receipt; see linking rule
 }
 
-
--- ---------------------------------------------------------------------------
--- Invariants
--- ---------------------------------------------------------------------------
+-- ============================================================
+-- Claim state machine
+-- ============================================================
+-- Lifecycle:
+--   SUBMITTED -> TRIAGED -> ASSESSING -> APPROVED -> PAID -> (CLOSED)
+--                       \-> DENIED   -> CLOSED (after 90d inactivity)
 
-invariant ClaimAmountWithinCoverage on Claim {
-  amount_claimed_pence <= policy.coverage_limit_pence
+transition Claim.submit {
+  effect:
+    creates Claim with status = SUBMITTED
+  guards:
+    policy exists and
+    policy.status = ACTIVE and
+    amount_claimed_pence <= policy.coverage_limit_pence
+  on_violation: raise ClaimRejected
 }
 
-invariant DeniedClaimsHaveReason on Claim {
-  status == denied implies denial_reason != null
+transition Claim.triage : SUBMITTED -> TRIAGED {
+  effect:
+    self.status = TRIAGED
+    self.last_activity_at = now()
+  on_violation: raise InvalidTransition
 }
 
-invariant PaidPayoutHasTimestamp on Payout {
-  status == paid implies paid_at != null
+transition Claim.start_assessment : TRIAGED -> ASSESSING {
+  guards:
+    assessor exists in Assessor
+  effect:
+    self.status = ASSESSING
+    self.last_activity_at = now()
+    creates Assessment with
+      status       = IN_PROGRESS,
+      started_at   = now(),
+      claim        = self,
+      assessor     = assessor
+  on_violation: raise InvalidTransition
 }
 
-invariant FailedPayoutHasFailureAttempt on Payout {
-  status == failed implies failed_attempts >= 1 and last_failure_at != null
+transition Claim.approve : ASSESSING -> APPROVED {
+  -- Guarded transition: requires a completed Assessment.
+  guards:
+    exists a in Assessment where
+      a.claim = self and a.status = COMPLETED
+  effect:
+    self.status = APPROVED
+    self.last_activity_at = now()
+  on_violation: raise InvalidTransition
 }
 
-invariant CompletedAssessmentHasTimestamp on Assessment {
-  status == completed implies completed_at != null
+transition Claim.deny : { TRIAGED, ASSESSING } -> DENIED {
+  inputs: reason : String
+  effect:
+    self.status = DENIED
+    self.denial_reason = reason
+    self.last_activity_at = now()
+  on_violation: raise InvalidTransition
 }
 
+transition Claim.mark_paid : APPROVED -> PAID {
+  -- Cascaded as a side-effect of Payout.mark_paid for one of this claim's payouts.
+  effect:
+    self.status = PAID
+    self.last_activity_at = now()
+}
 
--- ---------------------------------------------------------------------------
--- Claim state machine — single source of truth in app/services.py.
--- The `approve` transition is reachable from BOTH the adjuster API
--- (POST /claims/<n>/approve) AND the auto-approval scheduler (jobs.py).
--- ---------------------------------------------------------------------------
+transition Claim.close : DENIED -> CLOSED {
+  -- Driven by the auto_close_denied_job, not by adjusters.
+  effect:
+    self.status = CLOSED
+    self.last_activity_at = now()
+}
 
-state_machine Claim on status {
+-- ============================================================
+-- Assessment state machine
+-- ============================================================
 
-  transition submit
-    from (none)
-    to submitted
-    creates Claim
-    guard {
-      policy != null
-      policy.status == active
-      amount_claimed_pence <= policy.coverage_limit_pence
-    }
-    on_reject ClaimRejected
+transition Assessment.complete : IN_PROGRESS -> COMPLETED {
+  inputs: findings : String
+  effect:
+    self.findings = findings
+    self.status = COMPLETED
+    self.completed_at = now()
+    self.claim.last_activity_at = now()
+  on_violation: raise InvalidTransition
+}
 
-  transition triage
-    from submitted
-    to triaged
-    effect { last_activity_at = now() }
-    on_invalid InvalidTransition
+-- ============================================================
+-- Payout state machine
+-- ============================================================
 
-  transition start_assessment
-    from triaged
-    to assessing
-    requires { Assessor exists with name == input.assessor_name }
-    effect {
-      create Assessment {
-        claim = this
-        assessor = input.assessor
-        status = in_progress
-        started_at = now()
-      }
-      last_activity_at = now()
-    }
-    on_invalid InvalidTransition
+transition Payout.schedule {
+  -- Created only when its claim is APPROVED.
+  guards:
+    claim.status = APPROVED
+  effect:
+    creates Payout with
+      status         = SCHEDULED,
+      amount_pence   = claim.amount_claimed_pence,
+      scheduled_at   = now(),
+      claim          = claim
+    claim.last_activity_at = now()
+  on_violation: raise InvalidTransition
+}
 
-  transition approve
-    from assessing
-    to approved
-    guard {
-      exists Assessment a
-        where a.claim == this and a.status == completed
-    }
-    effect { last_activity_at = now() }
-    on_invalid InvalidTransition
+transition Payout.mark_paid : { SCHEDULED, FAILED } -> PAID {
+  effect:
+    self.status = PAID
+    self.paid_at = now()
+    self.claim.status = PAID            -- cascades to Claim.mark_paid
+    self.claim.last_activity_at = now()
+}
 
-  transition deny
-    from { triaged, assessing }
-    to denied
-    effect {
-      denial_reason = input.reason
-      last_activity_at = now()
-    }
-    on_invalid InvalidTransition
-
-  transition mark_paid_via_payout
-    from approved
-    to paid
-    triggered_by Payout.status -> paid
-    effect { last_activity_at = now() }
-
-  transition auto_close_denied
-    from denied
-    to closed
-    triggered_by job auto_close_denied_job
-    effect { last_activity_at = now() }
+transition Payout.mark_failed : { SCHEDULED, FAILED } -> FAILED {
+  effect:
+    self.status = FAILED
+    self.failed_attempts = self.failed_attempts + 1
+    self.last_failure_at = now()
 }
 
+-- ============================================================
+-- Temporal rules (scheduled jobs)
+-- ============================================================
 
--- ---------------------------------------------------------------------------
--- Assessment state machine
--- ---------------------------------------------------------------------------
-
-state_machine Assessment on status {
-
-  transition open
-    from (none)
-    to in_progress
-    triggered_by Claim.start_assessment
-    effect { started_at = now() }
+rule auto_acknowledge_submitted {
+  -- A claim sitting in SUBMITTED for 5 business days is auto-triaged.
+  when: every job_tick
+  for each c in Claim where c.status = SUBMITTED
+  if business_days_between(c.submitted_at, now()) >= 5
+  then: Claim.triage(c)
+}
 
-  transition complete
-    from in_progress
-    to completed
-    effect {
-      findings = input.findings
-      completed_at = now()
-      claim.last_activity_at = now()
-    }
-    on_invalid InvalidTransition
+rule flag_assessment_sla_breach {
+  -- Claims older than 14 days that have not reached a completed
+  -- assessment are flagged as out of SLA. (Also observable per-claim
+  -- via Claim.is_within_sla on read.)
+  when: every job_tick
+  for each c in Claim where c.status in { TRIAGED, ASSESSING }
+  if (now() - c.submitted_at) > ASSESSMENT_SLA
+  then: report sla_breach(c)
 }
 
-
--- ---------------------------------------------------------------------------
--- Payout state machine
--- ---------------------------------------------------------------------------
-
-state_machine Payout on status {
-
-  transition schedule
-    from (none)
-    to scheduled
-    triggered_by Claim.approve
-    creates Payout
-    guard { claim.status == approved }
-    effect {
-      amount_pence = claim.amount_claimed_pence
-      scheduled_at = now()
-      claim.last_activity_at = now()
-    }
-    on_invalid InvalidTransition
-
-  transition mark_paid
-    from { scheduled, failed }
-    to paid
-    effect {
-      paid_at = now()
-      claim.status = paid                   -- cascades to Claim state machine
-      claim.last_activity_at = now()
-    }
-
-  transition mark_failed
-    from { scheduled, failed }
-    to failed
-    effect {
-      failed_attempts = failed_attempts + 1
-      last_failure_at = now()
-    }
+rule retry_failed_payouts {
+  -- A FAILED payout is retried 28 days after its last failure
+  -- (or its scheduled_at, if it has never failed).
+  when: every job_tick
+  for each p in Payout where p.status = FAILED
+  let anchor = coalesce(p.last_failure_at, p.scheduled_at)
+  if (now() - anchor) >= PAYOUT_RETRY_AFTER
+  then:
+    try:
+      FasterPayments.send_faster_payment(
+        account_number = "00000000",
+        sort_code      = "00-00-00",
+        amount_pence   = p.amount_pence,
+        reference      = p.payout_id
+      )
+      Payout.mark_paid(p)
+    on PaymentError:
+      Payout.mark_failed(p)
 }
 
-
--- ---------------------------------------------------------------------------
--- Temporal rules / scheduled jobs
--- ---------------------------------------------------------------------------
-
-job auto_acknowledge_job {
-  description "Auto-triage SUBMITTED claims that have sat for 5+ business days."
-  for_each Claim c
-    where c.status == submitted
-      and business_days_between(c.submitted_at, now()) >= 5
-  action { invoke Claim.triage(c) }
+rule auto_close_denied_claims {
+  -- DENIED claims with no activity for 90 days transition to CLOSED.
+  when: every job_tick
+  for each c in Claim where c.status = DENIED
+  if (now() - c.last_activity_at) >= AUTO_CLOSE_DENIED_AFTER
+  then: Claim.close(c)
 }
 
-job assessment_sla_job {
-  description "Surface claims that have breached the 14-day assessment SLA."
-  for_each Claim c
-    where c.status in {triaged, assessing}
-      and (now() - c.submitted_at) > ASSESSMENT_SLA
-  action { emit SlaBreached(c.claim_number) }
+rule auto_approve_low_value_trusted_claims {
+  -- Scattered logic: Claim.approve is invoked BOTH from the adjuster API
+  -- (POST /claims/{n}/approve) AND from this scheduled job, for low-value
+  -- claims belonging to trusted holders, once the assessment is completed.
+  when: every job_tick
+  for each c in Claim where
+    c.status = ASSESSING and
+    c.amount_claimed_pence < AUTO_APPROVE_MAX_PENCE and
+    "trusted" in c.policy.holder_tags and
+    exists a in Assessment where a.claim = c and a.status = COMPLETED
+  then: Claim.approve(c)
 }
 
-job payout_retry_job {
-  description "Retry FAILED payouts that are older than 28 days."
-  for_each Payout p
-    where p.status == failed
-      and (now() - (p.last_failure_at ?? p.scheduled_at)) >= PAYOUT_RETRY_AFTER
-  action {
-    try {
-      FasterPayments.send_faster_payment(
-        account_number = "00000000",
-        sort_code = "00-00-00",
-        amount_pence = p.amount_pence,
-        reference = p.payout_id,
-      )
-      invoke Payout.mark_paid(p)
-    } catch PaymentError {
-      invoke Payout.mark_failed(p)
-    }
-  }
+-- ============================================================
+-- Invariants
+-- ============================================================
+
+invariant stalled_signal_is_derived {
+  -- Reinforces the modelling choice: stalled is computed, not stored.
+  Claim.is_stalled is not persisted
 }
 
-job auto_close_denied_job {
-  description "Close DENIED claims that have been inactive for 90 days."
-  for_each Claim c
-    where c.status == denied
-      and (now() - c.last_activity_at) >= AUTO_CLOSE_DENIED_AFTER
-  action {
-    set c.status = closed
-    set c.last_activity_at = now()
-  }
+invariant payment_amount_matches_claim {
+  -- Payouts schedule the claim's claimed amount, not a recomputed value.
+  for each p in Payout: p.amount_pence = p.claim.amount_claimed_pence
 }
 
-job auto_approval_scheduler {
-  description "
-    Auto-approve low-value claims for trusted holders once their assessment
-    is completed, so an adjuster doesn't need to click through them by hand.
-    Scattered logic: invokes the same Claim.approve transition as the
-    adjuster API in routes.py.
-  "
-  for_each Claim c
-    where c.status == assessing
-      and c.amount_claimed_pence < AUTO_APPROVE_MAX_PENCE
-      and "trusted" in c.policy.holder_tags
-      and exists Assessment a
-            where a.claim == c and a.status == completed
-  action { invoke Claim.approve(c) }
+invariant payout_cascade_to_claim {
+  -- Marking a Payout PAID transitions its Claim to PAID.
+  for each p in Payout where p.status = PAID:
+    p.claim.status = PAID
 }
 
+-- ============================================================
+-- HTTP surface (adjuster-facing API)
+-- ============================================================
 
--- ---------------------------------------------------------------------------
--- HTTP surface — adjuster-facing API (app/routes.py)
--- ---------------------------------------------------------------------------
-
 surface AdjusterAPI {
-
   POST /claims
-    body { claim_number, policy_number, incident_date, amount_claimed_pence }
-    action { invoke Claim.submit }
-    returns { claim_number, status }
+    body: {
+      claim_number         : String,
+      policy_number        : String,
+      incident_date        : DateTime,
+      amount_claimed_pence : Int
+    }
+    invokes: Claim.submit
+    returns: { claim_number, status }
+    errors:  ClaimRejected
 
-  POST /claims/<claim_number>/triage
-    action { invoke Claim.triage }
-    returns { claim_number, status }
+  POST /claims/{claim_number}/triage
+    invokes: Claim.triage
+    returns: { claim_number, status }
+    errors:  ClaimRejected, InvalidTransition
 
-  POST /claims/<claim_number>/assess
-    body { assessor_name }
-    action { invoke Claim.start_assessment }
-    returns { assessment_id, claim_number, assessor_name }
+  POST /claims/{claim_number}/assess
+    body: { assessor_name : String }
+    invokes: Claim.start_assessment
+    returns: { assessment_id, claim_number, assessor_name }
+    errors:  ClaimRejected, InvalidTransition
 
-  POST /claims/<claim_number>/approve
-    action {
-      invoke Claim.approve
-      invoke Payout.schedule
-    }
-    returns { claim_number, status, payout_id }
+  POST /claims/{claim_number}/approve
+    invokes: Claim.approve, then Payout.schedule
+    returns: { claim_number, status, payout_id }
+    errors:  ClaimRejected, InvalidTransition
 
-  POST /claims/<claim_number>/deny
-    body { reason }
-    action { invoke Claim.deny }
-    returns { claim_number, status, denial_reason }
+  POST /claims/{claim_number}/deny
+    body: { reason : String }
+    invokes: Claim.deny
+    returns: { claim_number, status, denial_reason }
+    errors:  ClaimRejected, InvalidTransition
 
-  POST /payouts/<payout_id>/mark-paid
-    action { invoke Payout.mark_paid }
-    returns { payout_id, status }
+  POST /payouts/{payout_id}/mark-paid
+    invokes: Payout.mark_paid
+    returns: { payout_id, status }
+    errors:  ClaimRejected
 
-  GET /policies/<policy_number>/claims
-    returns list of {
+  GET /policies/{policy_number}/claims
+    returns: list of {
       claim_number,
       status,
       amount_claimed_pence,
       is_within_sla,
-      is_stalled,
+      is_stalled
     }
-    over Claim c where c.policy.policy_number == policy_number
 
-  GET /claims/<claim_number>
-    returns {
+  GET /claims/{claim_number}
+    returns: {
       claim_number,
       policy_number,
       status,
@@ -436,111 +410,87 @@
       total_paid_pence,
       is_within_sla,
       is_stalled,
-      closed,
+      closed
     }
 }
 
+-- ============================================================
+-- Webhook surface (inbound from external feeds)
+-- ============================================================
 
--- ---------------------------------------------------------------------------
--- Webhook surface — inbound external feeds (app/webhooks.py)
--- ---------------------------------------------------------------------------
-
 surface IncidentWebhook {
-
   POST /webhooks/incident-reports
-    description "
-      External feeds (police, medical) push IncidentReport objects as they
-      happen. The system persists every report and best-effort links it to
-      an existing Claim by policy_number plus incident-date proximity
-      (±2 days).
-    "
-    body { source, policy_number?, incident_date, description }
-    action {
-      create IncidentReport r {
-        report_id = generate_uuid()
-        source = body.source
-        policy_number = body.policy_number
-        incident_date = body.incident_date
-        description = body.description
-        received_at = now()
-      }
-      if r.policy_number != null {
-        let match = first Claim c
-          where c.policy.policy_number == r.policy_number
-            and abs(c.incident_date - r.incident_date) <= INCIDENT_LINK_WINDOW
-        if match != null { set r.linked_claim = match }
-      }
+    source: external feeds (police, medical)
+    body: {
+      source        : String,        -- "police" | "medical"
+      policy_number : String?,       -- optional
+      incident_date : DateTime,
+      description   : String
     }
-    returns { report_id, linked_claim_number }
+    effect:
+      creates IncidentReport with
+        report_id    = uuid(),
+        received_at  = now(),
+        linked_claim = link_incident_to_claim(self)
+    returns: { report_id, linked_claim_number }
 }
 
+rule link_incident_to_claim {
+  -- Loose match: same policy + incident_date within +/- 2 days.
+  -- Returns null if policy_number is omitted or no claim matches.
+  on IncidentReport.received
+  let r = the report
+  if r.policy_number is not null:
+    pick any c in Claim where
+      c.policy.policy_number = r.policy_number and
+      abs(c.incident_date - r.incident_date) <= INCIDENT_LINK_WINDOW
+    then: r.linked_claim = c
+}
 
--- ---------------------------------------------------------------------------
--- Third-party integration: Faster Payments (bank).
--- Library-spec candidate — the bank owns this contract, not us.
--- ---------------------------------------------------------------------------
+-- ============================================================
+-- Third-party integrations (library-spec candidates)
+-- ============================================================
 
 contract FasterPayments {
+  -- Faster-Payments-shaped bank API. Real impl would POST over mTLS.
+  -- The contract surface is owned by the bank, not by this service.
 
-  type PaymentRequest {
-    account_number: String   -- must be exactly 8 digits
-    sort_code: String        -- must match NN-NN-NN
-    amount_pence: Integer    -- must be > 0 and <= 100_000_000
-    reference: String        -- appears on the recipient's statement
-  }
+  operation send_faster_payment(
+    account_number : String,   -- 8 digits
+    sort_code      : String,   -- NN-NN-NN
+    amount_pence   : Money,    -- > 0, <= 1_000_000_00 (£1M upstream cap)
+    reference      : String    -- appears on recipient statement
+  ) -> PaymentResult
 
-  type PaymentResult {
-    request: PaymentRequest
-    status: PaymentResultStatus
-    upstream_id: String      -- format: "fp-<reference>"
-    submitted_at: DateTime
+  PaymentResult {
+    request      : { account_number, sort_code, amount_pence, reference },
+    status       : PaymentResultStatus,
+    upstream_id  : String,           -- "fp-<reference>" in the fixture
+    submitted_at : DateTime
   }
 
-  error PaymentError
-
-  operation send_faster_payment
-    input {
-      account_number: String
-      sort_code: String
-      amount_pence: Integer
-      reference: String
-    }
-    guard {
-      amount_pence > 0
-        else raise PaymentError("amount must be positive")
-      length(account_number) == 8 and account_number matches /^[0-9]{8}$/
-        else raise PaymentError("account_number must be 8 digits")
-      sort_code matches /^[0-9]{2}-[0-9]{2}-[0-9]{2}$/
-        else raise PaymentError("sort_code must be in NN-NN-NN format")
-      amount_pence <= FASTER_PAYMENT_UPSTREAM_CAP_PENCE
-        else raise PaymentError("upstream caps Faster Payments at £1,000,000")
-    }
-    returns PaymentResult with status = accepted
+  errors:
+    PaymentError when amount_pence <= 0
+    PaymentError when account_number is not 8 digits
+    PaymentError when sort_code does not match NN-NN-NN
+    PaymentError when amount_pence > UPSTREAM_FASTER_PAYMENTS_CAP_PENCE
 }
 
+contract AssessorDispatch {
+  -- External assessor-network "request an assessor" endpoint. Caller
+  -- supplies required specialties; the network returns a dispatch ref.
 
--- ---------------------------------------------------------------------------
--- Third-party integration: assessor-network dispatch.
--- ---------------------------------------------------------------------------
+  operation request_assessor_dispatch(
+    claim_number : String,
+    specialties  : List<String>     -- non-empty
+  ) -> AssessorDispatch
 
-contract AssessorNetwork {
-
-  type AssessorDispatch {
-    dispatch_id: String     -- format: "disp-<8 hex chars>"
-    claim_number: String
-    specialties: List<String>
+  AssessorDispatch {
+    dispatch_id  : String,           -- "disp-<8 hex>" in the fixture
+    claim_number : String,
+    specialties  : List<String>
   }
 
-  error AssessorDispatchError
-
-  operation request_assessor_dispatch
-    input {
-      claim_number: String
-      specialties: List<String>
-    }
-    guard {
-      length(specialties) >= 1
-        else raise AssessorDispatchError("at least one specialty is required")
-    }
-    returns AssessorDispatch
+  errors:
+    AssessorDispatchError when specialties is empty
 }
```

