# A/B harness report

- results dir: `/Users/yavorpanayotov/IdeaProjects/allium-4.0/eval/results/2026-05-16T10-49-07-771Z`
- started: 2026-05-16T10:49:07.772Z
- model: (user default)
- prompt hash: `5ec924c8`

## Per-variant summary

### baseline (1 samples)

- `allium check` pass: **1/1**
- structural counts: _entities/fields from `allium model`; rule-likes & others from text regex_
- entity-like (entity / external entity / variant) median: **6** — per-sample: 6
- rule-like (rule / trigger / invariant) median: **20** — per-sample: 20
- field count (median): **41** — per-sample: 41
- other top-level constructs (totals across samples): config=1, enum=4
- only one sample — no determinism data

  - sample-1: pass (0E / 0W / 42I)
    - info@140:11: Rule 'RegisterPolicy' listens for trigger 'AdjusterRegistersPolicy' but no local
    - info@152:11: Rule 'RegisterAssessor' listens for trigger 'AdjusterRegistersAssessor' but no l
    - info@159:11: Rule 'SubmitClaim' listens for trigger 'AdjusterSubmitsClaim' but no local surfa
    - … and 39 more

### experimental (1 samples)

- `allium check` pass: **1/1**
- structural counts: _entities/fields from `allium model`; rule-likes & others from text regex_
- entity-like (entity / external entity / variant) median: **10** — per-sample: 10
- rule-like (rule / trigger / invariant) median: **19** — per-sample: 19
- field count (median): **38** — per-sample: 38
- other top-level constructs (totals across samples): actor=4, config=1, enum=4, surface=6
- only one sample — no determinism data

  - sample-1: pass (0E / 7W / 20I)
    - warning@466:12: Surface 'AdjusterAPI' binding 'adjuster' is not used in the surface body.
    - warning@513:12: Surface 'IncidentReportWebhook' binding 'client' is not used in the surface body
    - warning@523:12: Surface 'FasterPaymentsIntegration' binding 'bank' is not used in the surface bo
    - … and 24 more

## Inter-variant diff: baseline/sample-1 vs experimental/sample-1

### Structural

- entities: Jaccard 0.60
  - only in B: Adjuster, IncidentFeed, Bank, AssessorNetworkSystem

- rules: Jaccard 0.34
  - only in A: RegisterPolicy, RegisterAssessor, TriageClaim, ApproveClaim, SchedulePayout, PaymentRejectedByBank, RetryFailedPayout, PaymentsNeverExceedCoverage, DenialReasonOnlyWhenDenied, IncidentReportLinksMatchPolicy
  - only in B: AdjusterTriagesClaim, AdjusterApprovesClaim, MarkPayoutFailed, PayoutRetryDue, ClaimWithinCoverage, PaidClaimsHaveAPaidPayout, LinkedIncidentReportsMatchPolicy, AutoApprovedClaimsBelowThreshold, ClaimsAreLinkedToTheirPolicy

- field-count delta: -3 (baseline=41, experimental=38)

### Unified text diff

```diff
--- /Users/yavorpanayotov/IdeaProjects/allium-4.0/eval/results/2026-05-16T10-49-07-771Z/baseline/sample-1/spec.allium	2026-05-16 13:54:45
+++ /Users/yavorpanayotov/IdeaProjects/allium-4.0/eval/results/2026-05-16T10-49-07-771Z/experimental/sample-1/spec.allium	2026-05-16 14:05:06
@@ -1,112 +1,172 @@
 -- allium: 3
--- insurance-claims.allium
---
--- Scope: full claim lifecycle for the insurance-claims service: submission,
--- triage, assessment, approval/denial, payout, scheduled jobs and inbound
--- incident-report webhooks.
--- Excludes: HTTP routing layer, in-memory Store, Faster-Payments wire format.
+-- Insurance claims processing.
+-- Scope: end-to-end claim lifecycle (submission, triage, assessment,
+-- approval, denial, payout, retry, auto-close) plus inbound incident
+-- reports.
+-- Excludes: adjuster authentication, persistence, HTTP wire formats,
+-- analytics/reporting.
 
 ------------------------------------------------------------
+-- External Entities
+------------------------------------------------------------
+
+-- The adjuster is the operator on the other side of the internal API.
+-- Identity is not modelled by this spec; the actor exists for surface
+-- declarations only.
+external entity Adjuster {}
+
+-- Upstream feeds (police, medical assessors) that push IncidentReport
+-- payloads through the webhook.
+external entity IncidentFeed {}
+
+-- The bank's Faster-Payments-shaped service that settles payouts.
+external entity Bank {}
+
+-- The third-party assessor network that supplies assessors on demand.
+external entity AssessorNetworkSystem {}
+
+------------------------------------------------------------
 -- Enumerations
 ------------------------------------------------------------
 
 enum PolicyStatus { active | lapsed | cancelled }
-enum ClaimStatus { submitted | triaged | assessing | approved | denied | paid | closed }
-enum AssessmentStatus { pending | in_progress | completed }
+
+enum ClaimStatus {
+    submitted
+    | triaged
+    | assessing
+    | approved
+    | denied
+    | paid
+    | closed
+}
+
+enum AssessmentStatus { in_progress | completed }
+
 enum PayoutStatus { scheduled | paid | failed }
 
 ------------------------------------------------------------
--- Entities
+-- Entities and Variants
 ------------------------------------------------------------
 
 entity Policy {
     policy_number: String
     holder: String
-    coverage_limit_pence: Integer
+    coverage_limit: Integer
     status: PolicyStatus
     holder_tags: Set<String>
 
     claims: Claim with policy = this
-
     open_claims: claims where status not in {paid, denied, closed}
+
     has_open_claims: open_claims.count > 0
     is_trusted: "trusted" in holder_tags
+
+    -- Policy lifecycle is owned outside this spec; the system only
+    -- observes the current status.
+    transitions status {
+        terminal: active, lapsed, cancelled
+    }
 }
 
 entity Claim {
-    claim_number: String
     policy: Policy
+    claim_number: String
     incident_date: Timestamp
-    amount_claimed_pence: Integer
+    amount_claimed: Integer
     submitted_at: Timestamp
     last_activity_at: Timestamp
     status: ClaimStatus
-    denial_reason: String?
+    denial_reason: String when status = denied | closed
 
     assessments: Assessment with claim = this
     payouts: Payout with claim = this
+    incident_reports: IncidentReport with linked_claim = this
 
     completed_assessments: assessments where status = completed
     paid_payouts: payouts where status = paid
 
     age: now - submitted_at
     is_within_sla: age <= config.assessment_sla
-    is_stalled: status = assessing and (now - last_activity_at) > config.stalled_after
-    is_closed: status in {paid, denied, closed}
     has_completed_assessment: completed_assessments.count > 0
-    total_paid_pence: sum_pence(paid_payouts)
+    is_stalled: status = assessing
+        and now - last_activity_at > config.stalled_after
+    total_paid: sum_amounts(paid_payouts)
+    is_closed: status in {paid, denied, closed}
 
-    auto_ack_due:
-        status = submitted
-        and business_days_between(submitted_at, now) >= config.auto_ack_business_days
+    -- Auto-acknowledge fires once a submitted claim has aged five
+    -- business days. Business-day arithmetic is opaque to the spec.
+    auto_acknowledge_at:
+        add_business_days(submitted_at, config.auto_acknowledge_business_days)
 
-    auto_close_due:
-        status = denied
-        and (now - last_activity_at) >= config.auto_close_denied_after
+    -- Auto-close fires after a denied claim has been inactive for the
+    -- configured window. Re-evaluated against last_activity_at so any
+    -- touch resets the countdown.
+    auto_close_due_at: last_activity_at + config.auto_close_denied_after
 
-    auto_approve_eligible:
+    is_eligible_for_auto_approval:
         status = assessing
-        and amount_claimed_pence < config.auto_approve_max_pence
-        and has_completed_assessment
+        and amount_claimed < config.auto_approve_threshold
         and policy.is_trusted
-}
+        and has_completed_assessment
 
-entity Assessor {
-    name: String
-    specialties: Set<String>
-
-    assessments: Assessment with assessor = this
+    transitions status {
+        submitted -> triaged
+        triaged -> assessing
+        triaged -> denied
+        assessing -> approved
+        assessing -> denied
+        approved -> paid
+        denied -> closed
+        terminal: paid, closed
+    }
 }
 
 entity Assessment {
-    assessment_id: String
     claim: Claim
     assessor: Assessor
     findings: String
     status: AssessmentStatus
-    started_at: Timestamp?
-    completed_at: Timestamp?
+    started_at: Timestamp
+    completed_at: Timestamp when status = completed
+
+    transitions status {
+        in_progress -> completed
+        terminal: completed
+    }
 }
 
+entity Assessor {
+    name: String
+    specialties: Set<String>
+}
+
 entity Payout {
-    payout_id: String
     claim: Claim
-    amount_pence: Integer
+    amount: Integer
     status: PayoutStatus
     scheduled_at: Timestamp
-    paid_at: Timestamp?
+    paid_at: Timestamp when status = paid
     failed_attempts: Integer
     last_failure_at: Timestamp?
 
-    retry_anchor: last_failure_at ?? scheduled_at
+    -- Eligible for retry once the configured cooldown has elapsed
+    -- since the most recent failure. Optional because a payout that
+    -- has never failed has no retry timestamp.
+    next_retry_at: last_failure_at + config.payout_retry_after
 
-    is_retry_due:
-        status = failed
-        and (now - retry_anchor) >= config.payout_retry_after
+    transitions status {
+        scheduled -> paid
+        scheduled -> failed
+        failed -> paid
+        terminal: paid
+    }
 }
 
+-- IncidentReport originates upstream (police / medical feeds) but the
+-- system stores each received report and attempts a loose link to an
+-- existing claim by matching policy and incident-date proximity.
 entity IncidentReport {
-    report_id: String
     source: String
     policy_number: String?
     incident_date: Timestamp
@@ -120,78 +180,86 @@
 ------------------------------------------------------------
 
 config {
+    -- Maximum age (in submission time) for an assessment to still be
+    -- within SLA.
     assessment_sla: Duration = 14.days
+
+    -- How long an `assessing` claim can sit without activity before it
+    -- counts as stalled. Implicit state - no `stalled` enum value.
     stalled_after: Duration = 21.days
-    auto_ack_business_days: Integer = 5
+
+    -- Business days a `submitted` claim can sit before the system
+    -- auto-triages it.
+    auto_acknowledge_business_days: Integer = 5
+
+    -- Cooldown between a failed payout attempt and the next retry.
     payout_retry_after: Duration = 28.days
+
+    -- Calendar time a `denied` claim can sit inactive before it is
+    -- auto-closed.
     auto_close_denied_after: Duration = 90.days
-    auto_approve_max_pence: Integer = 50_000_00
+
+    -- Maximum amount (pence) the scheduler will auto-approve for a
+    -- trusted holder once their assessment is completed.
+    auto_approve_threshold: Integer = 5_000_000
+
+    -- Symmetric incident-date window used when linking inbound incident
+    -- reports to existing claims on the same policy.
     incident_link_window: Duration = 2.days
-    faster_payments_upstream_cap_pence: Integer = 1_000_000_00
+
+    -- Upstream Faster Payments hard cap (pence). Submissions above this
+    -- are rejected at the bank boundary.
+    upstream_payment_cap: Integer = 100_000_000
 }
 
 ------------------------------------------------------------
 -- Rules
 ------------------------------------------------------------
 
--- Policy and assessor registration --------------------------------------
+-- ---- Submission ------------------------------------------------------
 
-rule RegisterPolicy {
-    when: AdjusterRegistersPolicy(policy_number, holder, coverage_limit_pence, holder_tags)
-    requires: not exists Policy{policy_number}
-    ensures: Policy.created(
-        policy_number: policy_number,
-        holder: holder,
-        coverage_limit_pence: coverage_limit_pence,
-        status: active,
-        holder_tags: holder_tags
-    )
-}
-
-rule RegisterAssessor {
-    when: AdjusterRegistersAssessor(name, specialties)
-    ensures: Assessor.created(name: name, specialties: specialties)
-}
-
--- Claim submission -----------------------------------------------------
-
 rule SubmitClaim {
-    when: AdjusterSubmitsClaim(claim_number, policy, incident_date, amount_claimed_pence)
+    when: SubmitClaim(policy, claim_number, incident_date, amount_claimed)
 
     requires: policy.status = active
-    requires: amount_claimed_pence <= policy.coverage_limit_pence
+    requires: amount_claimed <= policy.coverage_limit
 
     ensures: Claim.created(
-        claim_number: claim_number,
         policy: policy,
+        claim_number: claim_number,
         incident_date: incident_date,
-        amount_claimed_pence: amount_claimed_pence,
+        amount_claimed: amount_claimed,
         submitted_at: now,
         last_activity_at: now,
         status: submitted
     )
 }
 
--- Triage --------------------------------------------------------------
+-- ---- Triage ----------------------------------------------------------
 
-rule TriageClaim {
-    when: AdjusterTriagesClaim(claim)
+rule AdjusterTriagesClaim {
+    when: TriageClaim(claim)
+
     requires: claim.status = submitted
+
     ensures: claim.status = triaged
     ensures: claim.last_activity_at = now
 }
 
 rule AutoAcknowledgeClaim {
-    when: claim: Claim.auto_ack_due
+    when: claim: Claim.auto_acknowledge_at <= now
+
     requires: claim.status = submitted
+
     ensures: claim.status = triaged
     ensures: claim.last_activity_at = now
 }
 
--- Assessment ----------------------------------------------------------
+-- ---- Assessment ------------------------------------------------------
 
 rule StartAssessment {
-    when: AdjusterStartsAssessment(claim, assessor)
+    when: StartAssessment(claim, assessor)
+
     requires: claim.status = triaged
 
     ensures: claim.status = assessing
@@ -206,7 +274,8 @@
 }
 
 rule CompleteAssessment {
-    when: AdjusterCompletesAssessment(assessment, findings)
+    when: CompleteAssessment(assessment, findings)
+
     requires: assessment.status = in_progress
 
     ensures: assessment.status = completed
@@ -215,9 +284,10 @@
     ensures: assessment.claim.last_activity_at = now
 }
 
--- Approval -----------------------------------------------------------
+-- ---- Approval --------------------------------------------------------
 
-rule ApproveClaim {
+-- Adjuster-driven approval also schedules the payout in a single step.
+rule AdjusterApprovesClaim {
     when: AdjusterApprovesClaim(claim)
 
     requires: claim.status = assessing
@@ -225,40 +295,58 @@
 
     ensures: claim.status = approved
     ensures: claim.last_activity_at = now
-    ensures: SchedulePayout(claim: claim)
+    ensures: Payout.created(
+        claim: claim,
+        amount: claim.amount_claimed,
+        status: scheduled,
+        scheduled_at: now,
+        failed_attempts: 0
+    )
 }
 
+-- Auto-approval (the nightly scheduler) approves low-value claims for
+-- trusted holders. It deliberately does NOT schedule a payout - that
+-- side of the workflow remains adjuster-driven.
 rule AutoApproveClaim {
-    when: claim: Claim.auto_approve_eligible
+    when: claim: Claim.is_eligible_for_auto_approval
 
+    requires: claim.status = assessing
+    requires: claim.has_completed_assessment
+
     ensures: claim.status = approved
     ensures: claim.last_activity_at = now
-
-    @guidance
-        -- The auto-approval scheduler intentionally does not schedule a
-        -- payout; an adjuster must trigger SchedulePayout separately.
-        -- See app/jobs.py:121 vs app/routes.py:53.
 }
 
--- Payout lifecycle ----------------------------------------------------
+-- ---- Denial and auto-close ------------------------------------------
 
-rule SchedulePayout {
-    when: SchedulePayout(claim)
-    requires: claim.status = approved
+rule DenyClaim {
+    when: DenyClaim(claim, reason)
+
+    requires: claim.status in {triaged, assessing}
 
-    ensures: Payout.created(
-        claim: claim,
-        amount_pence: claim.amount_claimed_pence,
-        status: scheduled,
-        scheduled_at: now,
-        failed_attempts: 0
-    )
+    ensures: claim.status = denied
+    ensures: claim.denial_reason = reason
+    ensures: claim.last_activity_at = now
 }
 
+rule AutoCloseDeniedClaim {
+    when: claim: Claim.auto_close_due_at <= now
+
+    requires: claim.status = denied
+
+    ensures: claim.status = closed
+    ensures: claim.last_activity_at = now
+}
+
+-- ---- Payout settlement ----------------------------------------------
+
+-- Marking a payout paid also flips the claim to `paid`. The claim must
+-- be in `approved` for this to be a valid transition.
 rule MarkPayoutPaid {
-    when: AdjusterMarksPayoutPaid(payout)
+    when: MarkPayoutPaid(payout)
 
     requires: payout.status in {scheduled, failed}
+    requires: payout.claim.status = approved
 
     ensures: payout.status = paid
     ensures: payout.paid_at = now
@@ -266,90 +354,198 @@
     ensures: payout.claim.last_activity_at = now
 }
 
-rule PaymentRejectedByBank {
-    when: FasterPaymentsRejectsPayout(payout)
+rule MarkPayoutFailed {
+    when: MarkPayoutFailed(payout)
 
-    requires: payout.status = scheduled
+    requires: payout.status in {scheduled, failed}
 
     ensures: payout.status = failed
     ensures: payout.failed_attempts = payout.failed_attempts + 1
     ensures: payout.last_failure_at = now
 }
 
-rule RetryFailedPayout {
-    when: payout: Payout.is_retry_due
+-- Once the retry cooldown has elapsed, the system asks the bank to
+-- re-attempt the payment. The outcome arrives back as either
+-- MarkPayoutPaid or MarkPayoutFailed.
+rule PayoutRetryDue {
+    when: payout: Payout.next_retry_at <= now
 
     requires: payout.status = failed
 
+    ensures: PaymentSubmissionRequested(
+        payout: payout,
+        amount: payout.amount
+    )
+}
+
+-- ---- Inbound incident reports ---------------------------------------
+
+rule ReceiveIncidentReport {
+    when: ReceiveIncidentReport(source, policy_number?, incident_date, description)
+
     ensures:
-        if faster_payments_accepts(payout):
-            payout.status = paid
-            payout.paid_at = now
-            payout.claim.status = paid
-            payout.claim.last_activity_at = now
-        else:
-            payout.failed_attempts = payout.failed_attempts + 1
-            payout.last_failure_at = now
+        let matching = find_matching_claim(
+            Claims,
+            policy_number,
+            incident_date,
+            config.incident_link_window
+        )
+        IncidentReport.created(
+            source: source,
+            policy_number: policy_number,
+            incident_date: incident_date,
+            description: description,
+            received_at: now,
+            linked_claim: matching
+        )
 }
 
--- Denial and close ----------------------------------------------------
+------------------------------------------------------------
+-- Invariants
+------------------------------------------------------------
 
-rule DenyClaim {
-    when: AdjusterDeniesClaim(claim, reason)
+invariant ClaimWithinCoverage {
+    for c in Claims:
+        c.amount_claimed <= c.policy.coverage_limit
+}
 
-    requires: claim.status in {triaged, assessing}
+invariant PaidClaimsHaveAPaidPayout {
+    for c in Claims:
+        c.status = paid implies c.payouts.any(p => p.status = paid)
+}
 
-    ensures: claim.status = denied
-    ensures: claim.denial_reason = reason
-    ensures: claim.last_activity_at = now
+invariant ApprovedClaimsHaveCompletedAssessment {
+    for c in Claims:
+        c.status in {approved, paid} implies c.has_completed_assessment
 }
 
-rule AutoCloseDeniedClaim {
-    when: claim: Claim.auto_close_due
-    requires: claim.status = denied
+invariant LinkedIncidentReportsMatchPolicy {
+    for r in IncidentReports:
+        r.linked_claim != null
+            implies r.linked_claim.policy.policy_number = r.policy_number
+}
 
-    ensures: claim.status = closed
-    ensures: claim.last_activity_at = now
+invariant AutoApprovedClaimsBelowThreshold {
+    for c in Claims:
+        c.is_eligible_for_auto_approval
+            implies c.amount_claimed < config.auto_approve_threshold
 }
 
--- Inbound incident-report webhook --------------------------------------
+invariant ClaimsAreLinkedToTheirPolicy {
+    for c in Claims:
+        c in c.policy.claims
+}
 
-rule ReceiveIncidentReport {
-    when: ExternalFeedSubmitsIncidentReport(source, policy_number, incident_date, description)
+------------------------------------------------------------
+-- Actor Declarations
+------------------------------------------------------------
 
-    let candidate = find_linked_claim(policy_number, incident_date, config.incident_link_window)
+actor ClaimAdjuster {
+    identified_by: Adjuster where true
+}
 
-    ensures: IncidentReport.created(
-        source: source,
-        policy_number: policy_number,
-        incident_date: incident_date,
-        description: description,
-        received_at: now,
-        linked_claim: candidate
-    )
+actor IncidentFeedClient {
+    identified_by: IncidentFeed where true
 }
 
+actor PaymentSystemClient {
+    identified_by: Bank where true
+}
+
+actor AssessorNetworkClient {
+    identified_by: AssessorNetworkSystem where true
+}
+
 ------------------------------------------------------------
--- Invariants
+-- Surfaces
 ------------------------------------------------------------
 
-invariant PaymentsNeverExceedCoverage {
-    for claim in Claims:
-        claim.total_paid_pence <= claim.policy.coverage_limit_pence
+-- Adjuster-facing HTTP API: the operator drives most lifecycle
+-- transitions by hand.
+surface AdjusterAPI {
+    facing adjuster: ClaimAdjuster
+
+    provides:
+        SubmitClaim(policy, claim_number, incident_date, amount_claimed)
+        TriageClaim(claim)
+        StartAssessment(claim, assessor)
+        CompleteAssessment(assessment, findings)
+        AdjusterApprovesClaim(claim)
+        DenyClaim(claim, reason)
+        MarkPayoutPaid(payout)
 }
 
-invariant DenialReasonOnlyWhenDenied {
-    for claim in Claims:
-        claim.denial_reason != null implies claim.status in {denied, closed}
+-- Read-only view of a single claim. Backs GET /claims/<claim_number>.
+surface ClaimDetailView {
+    facing viewer: ClaimAdjuster
+    context claim: Claim
+
+    exposes:
+        claim.claim_number
+        claim.policy.policy_number
+        claim.status
+        claim.amount_claimed
+        claim.total_paid
+        claim.is_within_sla
+        claim.is_stalled
+        claim.is_closed
 }
 
-invariant ApprovedClaimsHaveCompletedAssessment {
-    for claim in Claims:
-        claim.status in {approved, paid} implies claim.has_completed_assessment
+-- Read-only view of all claims on a policy. Backs
+-- GET /policies/<policy_number>/claims.
+surface PolicyClaimsView {
+    facing viewer: ClaimAdjuster
+    context policy: Policy
+
+    exposes:
+        for c in policy.claims:
+            c.claim_number
+            c.status
+            c.amount_claimed
+            c.is_within_sla
+            c.is_stalled
 }
 
-invariant IncidentReportLinksMatchPolicy {
-    for report in IncidentReports:
-        report.linked_claim != null
-            implies report.linked_claim.policy.policy_number = report.policy_number
+-- Inbound webhook used by police / medical feeds to push incident
+-- reports. policy_number is optional because some feeds report
+-- incidents without naming a policy.
+surface IncidentReportWebhook {
+    facing client: IncidentFeedClient
+
+    provides:
+        ReceiveIncidentReport(source, policy_number?, incident_date, description)
 }
+
+-- Boundary against the bank's Faster Payments service. The bank
+-- consumes PaymentSubmissionRequested emissions and reports back the
+-- per-payout outcome via MarkPayoutPaid or MarkPayoutFailed.
+surface FasterPaymentsIntegration {
+    facing bank: PaymentSystemClient
+
+    provides:
+        MarkPayoutPaid(payout)
+        MarkPayoutFailed(payout)
+
+    @guarantee PositiveAmount
+        -- Submitted payment amounts must be strictly positive (in pence).
+
+    @guarantee AccountNumberFormat
+        -- account_number is exactly 8 numeric digits.
+
+    @guarantee SortCodeFormat
+        -- sort_code matches NN-NN-NN: three pairs of digits separated by
+        -- single hyphens.
+
+    @guarantee UpstreamCap
+        -- amount must not exceed config.upstream_payment_cap; the
+        -- upstream service rejects anything above the cap.
+}
+
+-- Boundary against the third-party assessor network. A dispatch
+-- requires at least one specialty.
+surface AssessorDispatchIntegration {
+    facing network: AssessorNetworkClient
+
+    @guarantee NonEmptySpecialties
+        -- A dispatch request must include at least one specialty.
+}
```

