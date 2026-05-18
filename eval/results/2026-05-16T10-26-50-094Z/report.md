# A/B harness report

- results dir: `/Users/yavorpanayotov/IdeaProjects/allium-4.0/eval/results/2026-05-16T10-26-50-094Z`
- started: 2026-05-16T10:26:50.095Z
- model: (user default)
- prompt hash: `9b1692cd`

## Per-variant summary

### baseline (1 samples)

- `allium check` pass: **0/1**
- structural counts: _1/1 fully text-regex (parse failed); the rest from `allium model` + text regex_
- entity-like (entity / external entity / variant) median: **6** — per-sample: 6
- rule-like (rule / trigger / invariant) median: **12** — per-sample: 12
- field count (median): **31** — per-sample: 31
- other top-level constructs (totals across samples): contract=2, state_machine=3, surface=2
- only one sample — no determinism data

  - sample-1: FAIL (330E / 0W / 0I)
    - error@9:1: expected declaration (entity, rule, enum, value, config, surface, actor, given, 
    - error@15:1: expected declaration (entity, rule, enum, value, config, surface, actor, given, 
    - error@16:3: expected declaration (entity, rule, enum, value, config, surface, actor, given, 
    - … and 327 more

### experimental (1 samples)

- `allium check` pass: **0/1**
- structural counts: _entities/fields from `allium model`; rule-likes & others from text regex_
- entity-like (entity / external entity / variant) median: **6** — per-sample: 6
- rule-like (rule / trigger / invariant) median: **17** — per-sample: 17
- field count (median): **38** — per-sample: 38
- other top-level constructs (totals across samples): enum=5, integration=2, state_machine=3
- only one sample — no determinism data

  - sample-1: FAIL (323E / 5W / 40I)
    - error@3:1: expected declaration (entity, rule, enum, value, config, surface, actor, given, 
    - error@4:3: expected declaration (entity, rule, enum, value, config, surface, actor, given, 
    - error@5:1: expected declaration (entity, rule, enum, value, config, surface, actor, given, 
    - … and 365 more

## Inter-variant diff: baseline/sample-1 vs experimental/sample-1

### Structural

- entities: Jaccard 1.00

- rules: Jaccard 0.00
  - only in A: policy_must_be_active_to_submit, unknown_policy_rejected, amount_within_coverage_limit, approval_requires_completed_assessment, denial_only_from_triaged_or_assessing, payout_amount_matches_claim, denial_reason_required, auto_acknowledge, assessment_sla_breach, payout_retry, auto_close_denied, auto_approval
  - only in B: ApproveRequiresCompletedAssessment, SubmitGuards, StartAssessmentGuards, DenyGuards, SchedulePayoutGuards, AutoAcknowledge, AssessmentSLABreach, PayoutRetry, AutoCloseDenied, AutoApprovalForLowValueTrustedHolders, ClosedClaimsAreTerminal, PaidClaimImpliesPaidPayout, StalledIsDerivedNotStored, CoverageLimitRespectedAtSubmission, PolicyMustBeActiveAtSubmission, IncidentReportLinkingIsBestEffort, AssessmentCompletionTouchesClaim

- field-count delta: 7 (baseline=31, experimental=38)

### Unified text diff

```diff
--- /Users/yavorpanayotov/IdeaProjects/allium-4.0/eval/results/2026-05-16T10-26-50-094Z/baseline/sample-1/spec.allium	2026-05-16 13:31:15
+++ /Users/yavorpanayotov/IdeaProjects/allium-4.0/eval/results/2026-05-16T10-26-50-094Z/experimental/sample-1/spec.allium	2026-05-16 13:33:46
@@ -1,473 +1,531 @@
 -- allium: 3
--- Insurance claims processing system.
--- Adjusters submit, triage, assess, approve/deny and pay out on claims against
--- policies. Scheduled jobs auto-advance stalled work and external feeds push
--- incident reports in via webhook. Payouts are settled through a third-party
--- Faster Payments client; assessor dispatch goes through a separate
--- third-party network.
 
-system insurance_claims
+system InsuranceClaims {
+  description: "Adjuster-facing service for submitting, triaging, assessing, approving, denying and paying out on insurance claims. State machine on Claim is the single source of truth; scheduled jobs apply time-based rules; an inbound webhook ingests external IncidentReports and links them to claims by policy + date proximity."
+}
 
-----------------------------------------------------------------------
--- Status enums
-----------------------------------------------------------------------
+-- ---------------------------------------------------------------------------
+-- Status enumerations
+-- ---------------------------------------------------------------------------
 
-status PolicyStatus
-  ACTIVE
-  LAPSED
-  CANCELLED
+enum PolicyStatus {
+  active
+  lapsed
+  cancelled
+}
 
-status ClaimStatus
-  SUBMITTED
-  TRIAGED
-  ASSESSING
-  APPROVED
-  DENIED
-  PAID
-  CLOSED
+enum ClaimStatus {
+  submitted
+  triaged
+  assessing
+  approved
+  denied
+  paid
+  closed
+}
 
-status AssessmentStatus
-  PENDING
-  IN_PROGRESS
-  COMPLETED
+enum AssessmentStatus {
+  pending
+  in_progress
+  completed
+}
 
-status PayoutStatus
-  SCHEDULED
-  PAID
-  FAILED
+enum PayoutStatus {
+  scheduled
+  paid
+  failed
+}
 
-----------------------------------------------------------------------
+enum PaymentResultStatus {
+  accepted
+  rejected
+  pending_review
+}
+
+-- ---------------------------------------------------------------------------
 -- Temporal constants
-----------------------------------------------------------------------
+-- ---------------------------------------------------------------------------
 
-constant STALLED_AFTER             = 21 days
-constant ASSESSMENT_SLA            = 14 days
-constant AUTO_ACK_AFTER            = 5 business days
-constant PAYOUT_RETRY_AFTER        = 28 days
-constant AUTO_CLOSE_DENIED_AFTER   = 90 days
-constant AUTO_APPROVE_MAX_PENCE    = 5_000_000     -- £50,000 in pence
-constant INCIDENT_LINK_WINDOW      = 2 days
-constant FASTER_PAYMENTS_MAX_PENCE = 100_000_000   -- £1,000,000 upstream cap
+constants {
+  ASSESSMENT_SLA          : Duration = 14.days   -- claim must reach completed assessment within this window of submission
+  STALLED_AFTER           : Duration = 21.days   -- assessing claim with no activity for this long is implicitly stalled
+  AUTO_ACK_AFTER          : Duration = 5.business_days  -- SUBMITTED claims auto-triage after this
+  PAYOUT_RETRY_AFTER      : Duration = 28.days   -- FAILED payouts retried after this
+  AUTO_CLOSE_DENIED_AFTER : Duration = 90.days   -- DENIED claims with no activity auto-close after this
+  INCIDENT_LINK_WINDOW    : Duration = 2.days    -- IncidentReport links to a Claim if incident_date within this of claim.incident_date
+  AUTO_APPROVE_MAX_PENCE  : Money    = 50_000_00 -- £50,000 — strict upper bound for auto-approval
+  FASTER_PAYMENTS_CAP     : Money    = 1_000_000_00 -- £1,000,000 — upstream Faster Payments per-transaction cap
+}
 
-----------------------------------------------------------------------
+-- ---------------------------------------------------------------------------
 -- Core entities
-----------------------------------------------------------------------
+-- ---------------------------------------------------------------------------
 
-entity Policy
-  key  policy_number          : String
-       holder                 : String
-       coverage_limit_pence   : Int
-       status                 : PolicyStatus    = ACTIVE
-       holder_tags            : Set<String>     = {}
+entity Policy {
+  key policy_number       : String
+  holder                  : String
+  coverage_limit_pence    : Money
+  status                  : PolicyStatus default active
+  holder_tags             : Set<String> default {}
 
   derived has_open_claims : Bool =
-    exists Claim c
-      where c.policy == this
-        and c.status not in {PAID, DENIED, CLOSED}
+    exists c in Claim where c.policy = self and c.status not in {paid, denied, closed}
+}
 
-entity Claim
-  key  claim_number           : String
-       policy                 : Policy          -- FK: persisted as policy_number
-       incident_date          : DateTime
-       amount_claimed_pence   : Int
-       submitted_at           : DateTime        = now()
-       last_activity_at       : DateTime        = now()
-       status                 : ClaimStatus     = SUBMITTED
-       denial_reason          : String?
+entity Claim {
+  key claim_number        : String
+  policy                  : Policy                 -- FK policy_number → Policy
+  incident_date           : DateTime
+  amount_claimed_pence    : Money
+  submitted_at            : DateTime default now()
+  last_activity_at        : DateTime default now()
+  status                  : ClaimStatus default submitted
+  denial_reason           : String?
 
-  derived age : Duration =
-    now() - submitted_at
+  derived age             : Duration = now() - submitted_at
+  derived is_within_sla   : Bool     = age <= ASSESSMENT_SLA
+  derived is_stalled      : Bool     =                       -- implicit state — no `stalled` column
+    status = assessing and (now() - last_activity_at) > STALLED_AFTER
+  derived total_paid      : Money    =
+    sum p.amount_pence for p in Payout where p.claim = self and p.status = paid
+  derived is_closed       : Bool     = status in {paid, denied, closed}
 
-  derived is_within_sla : Bool =
-    age <= ASSESSMENT_SLA
+  invariant {
+    -- A claim's amount may not exceed the policy's coverage at submission time.
+    amount_claimed_pence <= policy.coverage_limit_pence
+  }
+}
 
-  -- Implicit state: no `stalled` column; derived from (status, last_activity_at).
-  derived is_stalled : Bool =
-    status == ASSESSING and (now() - last_activity_at) > STALLED_AFTER
+entity Assessor {
+  key name                : String
+  specialties             : Set<String> default {}
+}
 
-  derived total_paid_pence : Int =
-    sum p.amount_pence
-      for Payout p
-      where p.claim == this
-        and p.status == PAID
+entity Assessment {
+  key assessment_id       : String                 -- uuid4
+  claim                   : Claim                  -- FK claim_number → Claim
+  assessor                : Assessor               -- FK assessor_name → Assessor
+  findings                : String default ""
+  status                  : AssessmentStatus default pending
+  started_at              : DateTime?
+  completed_at            : DateTime?
+}
 
-  derived closed : Bool =
-    status in {PAID, DENIED, CLOSED}
+entity Payout {
+  key payout_id           : String                 -- uuid4
+  claim                   : Claim                  -- FK claim_number → Claim
+  amount_pence            : Money
+  status                  : PayoutStatus default scheduled
+  scheduled_at            : DateTime default now()
+  paid_at                 : DateTime?
+  failed_attempts         : Int default 0
+  last_failure_at         : DateTime?
+}
 
-entity Assessor
-  key  name                   : String
-       specialties            : Set<String>     = {}
+-- External entity: owned by upstream feeds (police / medical). The app only
+-- ingests, stores, and best-effort links to a Claim.
+external entity IncidentReport {
+  key report_id           : String                 -- uuid4 assigned on receipt
+  source                  : String                 -- e.g. "police", "medical"
+  policy_number           : String?                -- nullable — may arrive unlinked
+  incident_date           : DateTime
+  description             : String
+  received_at             : DateTime default now()
+  linked_claim            : Claim?                 -- populated on receipt iff a matching claim exists
+}
 
-entity Assessment
-  key  assessment_id          : String
-       claim                  : Claim
-       assessor               : Assessor
-       findings               : String          = ""
-       status                 : AssessmentStatus = PENDING
-       started_at             : DateTime?
-       completed_at           : DateTime?
+-- ---------------------------------------------------------------------------
+-- Claim state machine
+-- ---------------------------------------------------------------------------
 
-entity Payout
-  key  payout_id              : String
-       claim                  : Claim
-       amount_pence           : Int
-       status                 : PayoutStatus    = SCHEDULED
-       scheduled_at           : DateTime        = now()
-       paid_at                : DateTime?
-       failed_attempts        : Int             = 0
-       last_failure_at        : DateTime?
+state_machine Claim on status {
+  initial submitted
 
-----------------------------------------------------------------------
--- External entity (received via webhook from police / medical feeds)
-----------------------------------------------------------------------
+  transition submit_claim
+    to submitted
+    precondition {
+      policy exists
+      policy.status = active
+      amount_claimed_pence <= policy.coverage_limit_pence
+    }
 
-external entity IncidentReport
-  source       : "police" | "medical" | String
-  key  report_id              : String
-       policy_number          : String?
-       incident_date          : DateTime
-       description            : String
-       received_at            : DateTime        = now()
-       linked_claim           : Claim?
+  transition triage
+    from submitted to triaged
+    effect { touch last_activity_at }
 
-----------------------------------------------------------------------
--- Invariants
-----------------------------------------------------------------------
+  transition start_assessment
+    from triaged to assessing
+    precondition { assessor exists }
+    effect {
+      create Assessment with status = in_progress, started_at = now()
+      touch last_activity_at
+    }
 
-rule policy_must_be_active_to_submit
-  for each Claim c on create
-    require c.policy.status == ACTIVE
-    reject  "policy {c.policy.policy_number} is {c.policy.status}"
+  transition approve
+    from assessing to approved
+    precondition {
+      exists a in Assessment where a.claim = self and a.status = completed
+    }
+    effect { touch last_activity_at }
+    callers { POST /claims/{claim_number}/approve ; job auto_approval_scheduler }
 
-rule unknown_policy_rejected
-  for each Claim c on create
-    require c.policy exists
-    reject  "unknown policy"
-
-rule amount_within_coverage_limit
-  for each Claim c on create
-    require c.amount_claimed_pence <= c.policy.coverage_limit_pence
-    reject  "amount claimed exceeds coverage limit"
-
-rule approval_requires_completed_assessment
-  for each Claim c on transition to APPROVED
-    require exists Assessment a
-              where a.claim == c
-                and a.status == COMPLETED
-    reject  "claim has no completed assessment"
-
-rule denial_only_from_triaged_or_assessing
-  for each Claim c on transition to DENIED
-    require c.status@before in {TRIAGED, ASSESSING}
-
-rule payout_amount_matches_claim
-  for each Payout p on create
-    require p.amount_pence == p.claim.amount_claimed_pence
-
-rule denial_reason_required
-  for each Claim c where c.status == DENIED
-    require c.denial_reason is not null
-
-----------------------------------------------------------------------
--- Claim state machine
-----------------------------------------------------------------------
-
-state_machine Claim on status
-  initial SUBMITTED
-
-  transition triage
-    from SUBMITTED to TRIAGED
-    effect touch(last_activity_at)
-
-  transition start_assessment
-    from TRIAGED to ASSESSING
-    input  assessor : Assessor
-    require assessor exists
-    effect create Assessment
-             { claim = this
-             , assessor = assessor
-             , status = IN_PROGRESS
-             , started_at = now() }
-    effect touch(last_activity_at)
-
-  transition approve
-    from ASSESSING to APPROVED
-    require exists Assessment a
-              where a.claim == this
-                and a.status == COMPLETED
-    effect touch(last_activity_at)
-
   transition deny
-    from {TRIAGED, ASSESSING} to DENIED
-    input  reason : String
-    effect set denial_reason = reason
-    effect touch(last_activity_at)
+    from {triaged, assessing} to denied
+    effect {
+      set denial_reason = reason
+      touch last_activity_at
+    }
 
+  transition schedule_payout_after_approval
+    from approved
+    -- status remains `approved`; side-effect creates Payout
+    effect {
+      create Payout with amount_pence = self.amount_claimed_pence, status = scheduled
+      touch last_activity_at
+    }
+
   transition mark_paid
-    from APPROVED to PAID
-    -- Driven by Payout.mark_paid; see Payout state machine.
+    from approved to paid
+    trigger { Payout for self transitions to paid }
+    effect { touch last_activity_at }
 
   transition auto_close
-    from DENIED to CLOSED
-    -- Driven by auto_close_denied trigger after 90 days of inactivity.
-    effect touch(last_activity_at)
+    from denied to closed
+    trigger { job auto_close_denied_job }
+    effect { touch last_activity_at }
+}
 
-----------------------------------------------------------------------
+-- ---------------------------------------------------------------------------
 -- Assessment state machine
-----------------------------------------------------------------------
+-- ---------------------------------------------------------------------------
 
-state_machine Assessment on status
-  initial PENDING
+state_machine Assessment on status {
+  initial pending
 
   transition begin
-    from PENDING to IN_PROGRESS
-    effect set started_at = now()
+    from pending to in_progress
+    effect { set started_at = now() }
 
   transition complete
-    from IN_PROGRESS to COMPLETED
-    input  findings : String
-    effect set this.findings = findings
-    effect set completed_at  = now()
-    effect touch(this.claim.last_activity_at)
+    from in_progress to completed
+    effect {
+      set findings, completed_at = now()
+      touch claim.last_activity_at
+    }
+}
 
-----------------------------------------------------------------------
+-- ---------------------------------------------------------------------------
 -- Payout state machine
-----------------------------------------------------------------------
+-- ---------------------------------------------------------------------------
 
-state_machine Payout on status
-  initial SCHEDULED
+state_machine Payout on status {
+  initial scheduled
 
   transition mark_paid
-    from {SCHEDULED, FAILED} to PAID
-    effect set paid_at = now()
-    effect transition this.claim to PAID
+    from {scheduled, failed} to paid
+    effect {
+      set paid_at = now()
+      Claim self.claim transitions to paid
+    }
 
   transition mark_failed
-    from {SCHEDULED, PAID} to FAILED
-    effect increment failed_attempts
-    effect set last_failure_at = now()
+    from {scheduled, failed} to failed
+    effect {
+      set failed_attempts = failed_attempts + 1
+      set last_failure_at = now()
+    }
+}
 
-  on create
-    require this.claim.status == APPROVED
+-- ---------------------------------------------------------------------------
+-- Guarded transition: approve_claim
+-- ---------------------------------------------------------------------------
 
-----------------------------------------------------------------------
--- Scheduled (temporal) triggers
-----------------------------------------------------------------------
+rule ApproveRequiresCompletedAssessment {
+  description: "A claim may only be approved when it is currently `assessing` AND a completed assessment exists. Enforced in both adjuster-driven approval and the auto-approval scheduler."
+  when calling approve_claim(claim) {
+    require claim.status = assessing
+    require exists a in Assessment where a.claim = claim and a.status = completed
+  }
+}
 
-trigger auto_acknowledge
-  schedule: daily
-  for each Claim c
-    where c.status == SUBMITTED
-      and business_days_between(c.submitted_at, now()) >= AUTO_ACK_AFTER
-    do transition c via triage
+rule SubmitGuards {
+  description: "A claim can only be submitted against an existing, active policy and may not exceed coverage."
+  when calling submit_claim(policy, amount_claimed_pence) {
+    require policy exists
+    require policy.status = active
+    require amount_claimed_pence <= policy.coverage_limit_pence
+  }
+}
 
-trigger assessment_sla_breach
-  schedule: daily
-  for each Claim c
-    where c.status in {TRIAGED, ASSESSING}
-      and (now() - c.submitted_at) > ASSESSMENT_SLA
-    do emit SLA_BREACH { claim = c }
+rule StartAssessmentGuards {
+  description: "Assessment can only start from triaged, with a known assessor."
+  when calling start_assessment(claim, assessor_name) {
+    require claim.status = triaged
+    require Assessor[assessor_name] exists
+  }
+}
 
-trigger payout_retry
-  schedule: daily
-  for each Payout p
-    where p.status == FAILED
-      and (now() - coalesce(p.last_failure_at, p.scheduled_at)) >= PAYOUT_RETRY_AFTER
-    do call faster_payments.send_payment
-         { account_number = "00000000"
-         , sort_code      = "00-00-00"
-         , amount_pence   = p.amount_pence
-         , reference      = p.payout_id }
-       on success transition p via mark_paid
-       on PaymentError transition p via mark_failed
-
-trigger auto_close_denied
-  schedule: daily
-  for each Claim c
-    where c.status == DENIED
-      and (now() - c.last_activity_at) >= AUTO_CLOSE_DENIED_AFTER
-    do transition c via auto_close
+rule DenyGuards {
+  description: "Deny is only valid from triaged or assessing."
+  when calling deny_claim(claim) {
+    require claim.status in {triaged, assessing}
+  }
+}
 
-trigger auto_approval
-  schedule: daily
-  for each Claim c
-    where c.status == ASSESSING
-      and c.amount_claimed_pence < AUTO_APPROVE_MAX_PENCE
-      and "trusted" in c.policy.holder_tags
-      and exists Assessment a
-            where a.claim == c
-              and a.status == COMPLETED
-    do transition c via approve
-       -- Same `approve` transition as the adjuster API; scattered call sites.
+rule SchedulePayoutGuards {
+  description: "A payout can only be scheduled for an approved claim. Payout amount equals the claim's amount_claimed_pence."
+  when calling schedule_payout(claim) {
+    require claim.status = approved
+    ensure created Payout.amount_pence = claim.amount_claimed_pence
+  }
+}
 
-----------------------------------------------------------------------
+-- ---------------------------------------------------------------------------
+-- Temporal / scheduled-job rules
+-- ---------------------------------------------------------------------------
+
+rule AutoAcknowledge {
+  description: "Claims sitting in SUBMITTED for >= 5 business days are auto-triaged."
+  trigger: scheduled job auto_acknowledge_job
+  forall c in Claim where
+    c.status = submitted and
+    business_days_between(c.submitted_at, now()) >= 5
+  do triage_claim(c)
+}
+
+rule AssessmentSLABreach {
+  description: "Surface (not transition) claims that breached the 14-day assessment SLA — still in {triaged, assessing} and older than ASSESSMENT_SLA since submission."
+  trigger: scheduled job assessment_sla_job
+  forall c in Claim where
+    c.status in {triaged, assessing} and
+    (now() - c.submitted_at) > ASSESSMENT_SLA
+  emit SLABreached(c.claim_number)
+}
+
+rule PayoutRetry {
+  description: "Retry FAILED payouts whose last failure (or schedule, if never failed) is older than 28 days, by calling the upstream Faster Payments API."
+  trigger: scheduled job payout_retry_job
+  forall p in Payout where
+    p.status = failed and
+    (now() - coalesce(p.last_failure_at, p.scheduled_at)) >= PAYOUT_RETRY_AFTER
+  do {
+    try send_faster_payment(
+        account_number = "00000000",
+        sort_code      = "00-00-00",
+        amount_pence   = p.amount_pence,
+        reference      = p.payout_id
+      )
+    on success: mark_payout_paid(p)
+    on PaymentError: mark_payout_failed(p)
+  }
+}
+
+rule AutoCloseDenied {
+  description: "DENIED claims with no activity for 90 days transition to CLOSED."
+  trigger: scheduled job auto_close_denied_job
+  forall c in Claim where
+    c.status = denied and
+    (now() - c.last_activity_at) >= AUTO_CLOSE_DENIED_AFTER
+  do {
+    set c.status = closed
+    touch c.last_activity_at
+  }
+}
+
+rule AutoApprovalForLowValueTrustedHolders {
+  description: "Approve eligible claims without adjuster intervention. Eligibility: status = assessing, amount < £50,000 (strict), a completed assessment exists, and policy.holder_tags contains \"trusted\"."
+  trigger: scheduled job auto_approval_scheduler
+  forall c in Claim where
+    c.status = assessing and
+    c.amount_claimed_pence < AUTO_APPROVE_MAX_PENCE and
+    exists a in Assessment where a.claim = c and a.status = completed and
+    "trusted" in c.policy.holder_tags
+  do approve_claim(c)
+}
+
+-- ---------------------------------------------------------------------------
+-- Webhook: external IncidentReport ingestion
+-- ---------------------------------------------------------------------------
+
+webhook receive_incident_report {
+  endpoint: POST /webhooks/incident-reports
+  source: external (police, medical feeds)
+  payload {
+    source         : String
+    policy_number  : String?
+    incident_date  : DateTime
+    description    : String
+  }
+  effect {
+    create IncidentReport with
+      report_id   = uuid(),
+      received_at = now(),
+      source, policy_number, incident_date, description
+    -- best-effort linking by policy + date proximity
+    if policy_number is not null:
+      let match = first c in Claim where
+        c.policy.policy_number = policy_number and
+        abs(c.incident_date - incident_date) <= INCIDENT_LINK_WINDOW
+      if match exists: set linked_claim = match
+  }
+  response {
+    report_id           : String
+    linked_claim_number : String?
+  }
+}
+
+-- ---------------------------------------------------------------------------
 -- HTTP surface (adjuster-facing API)
-----------------------------------------------------------------------
+-- ---------------------------------------------------------------------------
 
-surface http_api
+api {
+  POST   /claims                              -> submit_claim
+    body { claim_number, policy_number, incident_date, amount_claimed_pence }
+    returns { claim_number, status }
 
-  POST /claims
-    body  { claim_number         : String
-          , policy_number        : String
-          , incident_date        : DateTime
-          , amount_claimed_pence : Int }
-    do    create Claim
-            { claim_number         = body.claim_number
-            , policy               = Policy(body.policy_number)
-            , incident_date        = body.incident_date
-            , amount_claimed_pence = body.amount_claimed_pence }
-    returns { claim_number : String, status : ClaimStatus }
-    errors  ClaimRejected -> 4xx
+  POST   /claims/{claim_number}/triage        -> triage_claim
+    returns { claim_number, status }
 
-  POST /claims/{claim_number}/triage
-    do    transition Claim(claim_number) via triage
-    returns { claim_number : String, status : ClaimStatus }
-    errors  InvalidTransition -> 4xx
+  POST   /claims/{claim_number}/assess        -> start_assessment
+    body { assessor_name }
+    returns { assessment_id, claim_number, assessor_name }
 
-  POST /claims/{claim_number}/assess
-    body  { assessor_name : String }
-    do    transition Claim(claim_number) via start_assessment
-            { assessor = Assessor(body.assessor_name) }
-    returns { assessment_id : String
-            , claim_number  : String
-            , assessor_name : String }
-    errors  InvalidTransition, ClaimRejected -> 4xx
+  POST   /claims/{claim_number}/approve       -> approve_claim + schedule_payout
+    returns { claim_number, status, payout_id }
+    note: "Adjuster path. Always schedules a payout immediately after a successful approval."
 
-  POST /claims/{claim_number}/approve
-    -- Adjuster-driven approval. Same transition is also fired by the
-    -- auto_approval scheduled trigger for low-value, trusted-holder claims.
-    do    transition Claim(claim_number) via approve
-          then create Payout
-                 { claim        = Claim(claim_number)
-                 , amount_pence = Claim(claim_number).amount_claimed_pence }
-    returns { claim_number : String
-            , status       : ClaimStatus
-            , payout_id    : String }
-    errors  InvalidTransition -> 4xx
+  POST   /claims/{claim_number}/deny          -> deny_claim
+    body { reason }
+    returns { claim_number, status, denial_reason }
 
-  POST /claims/{claim_number}/deny
-    body  { reason : String }
-    do    transition Claim(claim_number) via deny { reason = body.reason }
-    returns { claim_number   : String
-            , status         : ClaimStatus
-            , denial_reason  : String }
-    errors  InvalidTransition -> 4xx
+  POST   /payouts/{payout_id}/mark-paid       -> mark_payout_paid
+    returns { payout_id, status }
+    note: "Cascades Claim.status -> paid."
 
-  POST /payouts/{payout_id}/mark-paid
-    do    transition Payout(payout_id) via mark_paid
-    returns { payout_id : String, status : PayoutStatus }
+  GET    /policies/{policy_number}/claims     -> list claims for policy
+    returns [{ claim_number, status, amount_claimed_pence, is_within_sla, is_stalled }]
 
-  GET  /policies/{policy_number}/claims
-    returns list of
-      { claim_number         : String
-      , status               : ClaimStatus
-      , amount_claimed_pence : Int
-      , is_within_sla        : Bool
-      , is_stalled           : Bool }
-    source: all Claim c where c.policy.policy_number == policy_number
+  GET    /claims/{claim_number}               -> claim detail
+    returns {
+      claim_number, policy_number, status,
+      amount_claimed_pence, total_paid_pence,
+      is_within_sla, is_stalled,
+      closed   -- status in {paid, denied, closed}
+    }
 
-  GET  /claims/{claim_number}
-    returns { claim_number         : String
-            , policy_number        : String
-            , status               : ClaimStatus
-            , amount_claimed_pence : Int
-            , total_paid_pence     : Int
-            , is_within_sla        : Bool
-            , is_stalled           : Bool
-            , closed               : Bool }
+  POST   /webhooks/incident-reports           -> receive_incident_report
+    -- see webhook block above
+}
 
-----------------------------------------------------------------------
--- Inbound webhook
-----------------------------------------------------------------------
+-- ---------------------------------------------------------------------------
+-- Third-party integrations (library-spec candidates)
+-- ---------------------------------------------------------------------------
 
-surface webhooks
+integration FasterPayments {
+  description: "Upstream Faster Payments-shaped bank API. Contract owned by the bank, not by this service."
 
-  POST /webhooks/incident-reports
-    description: "External feeds (police, medical) push incident reports."
-    body  { source         : String
-          , policy_number  : String?
-          , incident_date  : DateTime
-          , description    : String }
-    do    create IncidentReport
-            { report_id      = generate_uuid()
-            , source         = body.source
-            , policy_number  = body.policy_number
-            , incident_date  = body.incident_date
-            , description    = body.description
-            , received_at    = now() }
-          then try_link_report
-    returns { report_id           : String
-            , linked_claim_number : String? }
+  request PaymentRequest {
+    account_number : String  -- 8 digits, numeric
+    sort_code      : String  -- NN-NN-NN format
+    amount_pence   : Money   -- must be > 0 and <= FASTER_PAYMENTS_CAP
+    reference      : String  -- appears on recipient statement
+  }
 
-  process try_link_report on IncidentReport r
-    -- Loose match: same policy_number, incident_date within ±2 days.
-    when r.policy_number is not null
-      let candidate =
-        first Claim c
-          where c.policy.policy_number == r.policy_number
-            and abs(c.incident_date - r.incident_date) <= INCIDENT_LINK_WINDOW
-      when candidate exists
-        set r.linked_claim = candidate
+  response PaymentResult {
+    request       : PaymentRequest
+    status        : PaymentResultStatus
+    upstream_id   : String   -- shape: "fp-{reference}" in this fixture
+    submitted_at  : DateTime
+  }
 
-----------------------------------------------------------------------
--- Third-party integrations (contracts owned by external systems)
-----------------------------------------------------------------------
+  error PaymentError raised when {
+    amount_pence <= 0
+    length(account_number) != 8 or not account_number is numeric
+    sort_code not matching NN-NN-NN
+    amount_pence > FASTER_PAYMENTS_CAP
+    -- in production: any non-2xx response
+  }
 
-contract faster_payments
-  description:
-    "UK Faster Payments-shaped client. The bank owns this API contract;
-     the spec captures only what we observe and depend on."
+  operation send_faster_payment(account_number, sort_code, amount_pence, reference) -> PaymentResult
+}
 
-  operation send_payment
-    input
-      account_number : String  where length == 8 and digits_only
-      sort_code      : String  where matches "^[0-9]{2}-[0-9]{2}-[0-9]{2}$"
-      amount_pence   : Int     where > 0 and <= FASTER_PAYMENTS_MAX_PENCE
-      reference      : String
-    output PaymentResult
-      request        : PaymentRequest
-      status         : PaymentResultStatus
-      upstream_id    : String
-      submitted_at   : DateTime
-    errors
-      PaymentError "amount must be positive"
-      PaymentError "account_number must be 8 digits"
-      PaymentError "sort_code must be in NN-NN-NN format"
-      PaymentError "upstream caps Faster Payments at £1,000,000"
+integration AssessorDispatchNetwork {
+  description: "External assessor-network dispatch API. We request an assessor with a list of specialties, the network returns a dispatch reference."
 
-  status PaymentResultStatus
-    ACCEPTED
-    REJECTED
-    PENDING_REVIEW
+  response AssessorDispatch {
+    dispatch_id   : String   -- shape: "disp-{8hex}" in this fixture
+    claim_number  : String
+    specialties   : List<String>
+  }
 
-contract assessor_network
-  description:
-    "External assessor-dispatch network. We request an assessor with a list
-     of required specialties and receive a dispatch reference."
+  error AssessorDispatchError raised when {
+    specialties is empty
+  }
 
-  operation request_dispatch
-    input
-      claim_number : String
-      specialties  : List<String>  where size >= 1
-    output AssessorDispatch
-      dispatch_id  : String
-      claim_number : String
-      specialties  : List<String>
-    errors
-      AssessorDispatchError "at least one specialty is required"
+  operation request_assessor_dispatch(claim_number, specialties) -> AssessorDispatch
+}
 
-----------------------------------------------------------------------
--- Notes on scattered logic
-----------------------------------------------------------------------
+-- ---------------------------------------------------------------------------
+-- Cross-cutting invariants
+-- ---------------------------------------------------------------------------
 
-note approval_call_sites
-  The `approve` transition on Claim is reachable from two places:
-    1. POST /claims/{claim_number}/approve  (adjuster-driven)
-    2. trigger auto_approval                (low-value, trusted-holder claims)
-  Both paths converge on the same guarded transition; the
-  approval_requires_completed_assessment invariant therefore applies to both.
+invariant ClosedClaimsAreTerminal {
+  description: "Once a claim is in {paid, denied, closed} it does not transition further (no outbound transitions defined from these states)."
+  forall c in Claim:
+    c.status in {paid, denied, closed} implies no_future_transition(c.status)
+}
 
-note implicit_stalled_state
-  There is no `stalled` column on Claim. `is_stalled` is derived purely from
-  (status == ASSESSING) and (now() - last_activity_at) > STALLED_AFTER.
-  Callers must compute, not persist, this property.
+invariant PaidClaimImpliesPaidPayout {
+  description: "Claim.status = paid is only set as a side effect of a Payout for it transitioning to paid."
+  forall c in Claim where c.status = paid:
+    exists p in Payout where p.claim = c and p.status = paid
+}
+
+invariant StalledIsDerivedNotStored {
+  description: "There is no `stalled` column on Claim. is_stalled is computed from (status, last_activity_at) at read time."
+  Claim has no field named stalled
+  Claim.is_stalled is derived
+}
+
+invariant CoverageLimitRespectedAtSubmission {
+  description: "Submission rejects amounts above the policy's coverage_limit_pence. The limit is checked at submission only; later mutations to coverage_limit_pence do not retroactively invalidate accepted claims."
+  forall c in Claim:
+    c.amount_claimed_pence <= c.policy.coverage_limit_pence  -- at submission time
+}
+
+invariant PolicyMustBeActiveAtSubmission {
+  description: "Claims may only be submitted against ACTIVE policies."
+  forall c in Claim:
+    policy_status_at(c.policy, c.submitted_at) = active
+}
+
+invariant IncidentReportLinkingIsBestEffort {
+  description: "linked_claim_number is set at most once, at receipt, iff a matching claim exists. No retro-linking job revisits unlinked reports."
+  forall r in IncidentReport:
+    r.linked_claim is set only_at r.received_at
+}
+
+invariant AssessmentCompletionTouchesClaim {
+  description: "Completing an assessment refreshes the parent claim's last_activity_at, which delays is_stalled."
+  forall a in Assessment where a.status transitions to completed:
+    a.claim.last_activity_at = now()
+}
+
+-- ---------------------------------------------------------------------------
+-- Observability surface
+-- ---------------------------------------------------------------------------
+
+events {
+  ClaimSubmitted(claim_number, policy_number, amount_claimed_pence)
+  ClaimTriaged(claim_number, auto: Bool)             -- auto = true iff via auto_acknowledge_job
+  AssessmentStarted(assessment_id, claim_number, assessor_name)
+  AssessmentCompleted(assessment_id, claim_number)
+  ClaimApproved(claim_number, auto: Bool)            -- auto = true iff via auto_approval_scheduler
+  PayoutScheduled(payout_id, claim_number, amount_pence)
+  PayoutPaid(payout_id, claim_number)
+  PayoutFailed(payout_id, claim_number, failed_attempts)
+  ClaimDenied(claim_number, denial_reason)
+  ClaimAutoClosed(claim_number)
+  SLABreached(claim_number)
+  IncidentReportReceived(report_id, source, linked_claim_number)
+}
```

