# Insurance claims fixture

A small Python web service for processing insurance claims. It is the input
codebase for the `distill` A/B harness — distill reads it, produces an Allium
spec, and we compare specs across variants and across runs.

The code is built only against the standard library so the package is
importable without third-party dependencies. It is *not* meant to be run
end-to-end; it exists to be read.

## Domain

Five core entities plus one external entity:

| Entity           | File                     | Notes                                                        |
|------------------|--------------------------|--------------------------------------------------------------|
| `Policy`         | `app/models.py:61`       | holder, coverage limit, status, holder_tags                  |
| `Claim`          | `app/models.py:77`       | policy_number (FK), incident_date, status, amount, activity  |
| `Assessor`       | `app/models.py:118`      | name, specialties (Set\<String\>)                            |
| `Assessment`     | `app/models.py:124`      | claim_number, assessor_name, findings, status                |
| `Payout`         | `app/models.py:135`      | claim_number, amount, status, retry bookkeeping              |
| `IncidentReport` | `app/models.py:147`      | **External** — arrives via webhook from police/medical feeds |

## File layout

```
app/
├── __init__.py            # tiny Router + Store + package wiring
├── models.py              # all entities + status enums + temporal constants
├── services.py            # claim-lifecycle transitions (single source of truth)
├── routes.py              # adjuster-facing HTTP API
├── jobs.py                # scheduled jobs (auto-ack, SLA, retry, auto-close, auto-approval)
├── webhooks.py            # inbound IncidentReport webhook
└── integrations/
    ├── payment.py         # Faster-Payments-shaped third-party client
    └── assessor.py        # assessor-dispatch third-party client
```

## Patterns exercised

Each row maps a pattern the distill skill has to handle to a specific site in
the fixture. Reviewers can use this table to audit a distilled spec — every
pattern should be reflected.

| #  | Pattern                       | Where to find it                                                                                                                  |
|----|-------------------------------|-----------------------------------------------------------------------------------------------------------------------------------|
| 1  | Status enums / state machines | `app/models.py:23` (PolicyStatus), `:29` (ClaimStatus), `:39` (AssessmentStatus), `:45` (PayoutStatus)                            |
| 2  | Guarded transitions           | `app/services.py:108` (`approve_claim` requires `status == ASSESSING` **and** a completed Assessment)                             |
| 3  | Temporal rules                | `app/jobs.py:33-36` constants; `:57` auto-ack (5 business days), `:70` 14-day SLA, `:83` 28-day payout retry, `:107` 90-day close |
| 4  | External entity (via webhook) | `app/models.py:147` `IncidentReport` + `app/webhooks.py:18` receiver + `:42` linking by policy + date proximity                   |
| 5  | Third-party integration       | `app/integrations/payment.py` (Faster-Payments-shaped — library-spec candidate) and `app/integrations/assessor.py`                |
| 6  | Implicit state machine        | `app/models.py:95` `Claim.is_stalled` — derived from `(status, last_activity_at)`; **no `stalled` column** (see `:53` constant)   |
| 7  | Scattered logic               | `approve_claim` called from both `app/routes.py:53` (adjuster API) **and** `app/jobs.py:121` (`auto_approval_scheduler`)          |
| 8  | Derived properties            | `app/models.py:91` `is_within_sla`, `:95` `is_stalled`, `:106` `total_paid`, and `app/models.py:68` `Policy.has_open_claims`      |
| 9  | FK → relationship             | `app/models.py:79` `Claim.policy_number: str` — should distil to `policy: Policy`, not a string field                             |

## Sanity check

```sh
cd fixtures/insurance-claims
python3 -c "import app; print(len(app.app.routes), 'routes')"
# expected: 9 routes
```
