# Propagation report

## Summary

- Backend: pytest+hypothesis
- Framework language: python
- Obligations total: 96
- Obligations covered: 0  (passing tests: 0)
- Bridge unresolved: 0
- Likely real failures: 0  ← human review
- Likely wrong bridges: 46  ← re-mapping
- Infrastructure gaps: 0

Runner: `python3 -m pytest --junit-xml=/var/folders/sc/gnctv8950jq16vtlllz9mcyr0000gn/T/propagate-stagec-9NN3j9/report.xml .`
Exit code: 2

## Errors (likely wrong bridges)

- `.py::tests.test_approve_claim` — obligation `<unknown>`
  - ImportError while importing test module '/Users/yavorpanayotov/IdeaProjects/allium-4.0/eval/results/2026-05-17T17-39-02-497Z/propagate/experimental/pytest+hypothesis/insurance-claims/sample-2/workdir/tests/test_approve_claim.py'.
- `.py::tests.test_approved_claims_have_completed_assessment` — obligation `<unknown>`
  - ImportError while importing test module '/Users/yavorpanayotov/IdeaProjects/allium-4.0/eval/results/2026-05-17T17-39-02-497Z/propagate/experimental/pytest+hypothesis/insurance-claims/sample-2/workdir/tests/test_approved_claims_have_complete
- `.py::tests.test_assessment` — obligation `<unknown>`
  - ImportError while importing test module '/Users/yavorpanayotov/IdeaProjects/allium-4.0/eval/results/2026-05-17T17-39-02-497Z/propagate/experimental/pytest+hypothesis/insurance-claims/sample-2/workdir/tests/test_assessment.py'.
- `.py::tests.test_assessment_sla` — obligation `<unknown>`
  - ImportError while importing test module '/Users/yavorpanayotov/IdeaProjects/allium-4.0/eval/results/2026-05-17T17-39-02-497Z/propagate/experimental/pytest+hypothesis/insurance-claims/sample-2/workdir/tests/test_assessment_sla.py'.
- `.py::tests.test_assessment_sla_job` — obligation `<unknown>`
  - ImportError while importing test module '/Users/yavorpanayotov/IdeaProjects/allium-4.0/eval/results/2026-05-17T17-39-02-497Z/propagate/experimental/pytest+hypothesis/insurance-claims/sample-2/workdir/tests/test_assessment_sla_job.py'.
- `.py::tests.test_assessment_status` — obligation `<unknown>`
  - ImportError while importing test module '/Users/yavorpanayotov/IdeaProjects/allium-4.0/eval/results/2026-05-17T17-39-02-497Z/propagate/experimental/pytest+hypothesis/insurance-claims/sample-2/workdir/tests/test_assessment_status.py'.
- `.py::tests.test_assessor` — obligation `<unknown>`
  - ImportError while importing test module '/Users/yavorpanayotov/IdeaProjects/allium-4.0/eval/results/2026-05-17T17-39-02-497Z/propagate/experimental/pytest+hypothesis/insurance-claims/sample-2/workdir/tests/test_assessor.py'.
- `.py::tests.test_assessor_dispatch` — obligation `<unknown>`
  - ImportError while importing test module '/Users/yavorpanayotov/IdeaProjects/allium-4.0/eval/results/2026-05-17T17-39-02-497Z/propagate/experimental/pytest+hypothesis/insurance-claims/sample-2/workdir/tests/test_assessor_dispatch.py'.
- `.py::tests.test_assessor_service` — obligation `<unknown>`
  - ImportError while importing test module '/Users/yavorpanayotov/IdeaProjects/allium-4.0/eval/results/2026-05-17T17-39-02-497Z/propagate/experimental/pytest+hypothesis/insurance-claims/sample-2/workdir/tests/test_assessor_service.py'.
- `.py::tests.test_auto_ack_after` — obligation `<unknown>`
  - ImportError while importing test module '/Users/yavorpanayotov/IdeaProjects/allium-4.0/eval/results/2026-05-17T17-39-02-497Z/propagate/experimental/pytest+hypothesis/insurance-claims/sample-2/workdir/tests/test_auto_ack_after.py'.
- `.py::tests.test_auto_acknowledge_job` — obligation `<unknown>`
  - ImportError while importing test module '/Users/yavorpanayotov/IdeaProjects/allium-4.0/eval/results/2026-05-17T17-39-02-497Z/propagate/experimental/pytest+hypothesis/insurance-claims/sample-2/workdir/tests/test_auto_acknowledge_job.py'.
- `.py::tests.test_auto_approval_scheduler` — obligation `<unknown>`
  - ImportError while importing test module '/Users/yavorpanayotov/IdeaProjects/allium-4.0/eval/results/2026-05-17T17-39-02-497Z/propagate/experimental/pytest+hypothesis/insurance-claims/sample-2/workdir/tests/test_auto_approval_scheduler.py'.
- `.py::tests.test_auto_approve_max_pence` — obligation `<unknown>`
  - ImportError while importing test module '/Users/yavorpanayotov/IdeaProjects/allium-4.0/eval/results/2026-05-17T17-39-02-497Z/propagate/experimental/pytest+hypothesis/insurance-claims/sample-2/workdir/tests/test_auto_approve_max_pence.py'.
- `.py::tests.test_auto_close_denied_after` — obligation `<unknown>`
  - ImportError while importing test module '/Users/yavorpanayotov/IdeaProjects/allium-4.0/eval/results/2026-05-17T17-39-02-497Z/propagate/experimental/pytest+hypothesis/insurance-claims/sample-2/workdir/tests/test_auto_close_denied_after.py'.
- `.py::tests.test_auto_close_denied_job` — obligation `<unknown>`
  - ImportError while importing test module '/Users/yavorpanayotov/IdeaProjects/allium-4.0/eval/results/2026-05-17T17-39-02-497Z/propagate/experimental/pytest+hypothesis/insurance-claims/sample-2/workdir/tests/test_auto_close_denied_job.py'.
- `.py::tests.test_claim` — obligation `<unknown>`
  - ImportError while importing test module '/Users/yavorpanayotov/IdeaProjects/allium-4.0/eval/results/2026-05-17T17-39-02-497Z/propagate/experimental/pytest+hypothesis/insurance-claims/sample-2/workdir/tests/test_claim.py'.
- `.py::tests.test_claim_amount_within_coverage` — obligation `<unknown>`
  - ImportError while importing test module '/Users/yavorpanayotov/IdeaProjects/allium-4.0/eval/results/2026-05-17T17-39-02-497Z/propagate/experimental/pytest+hypothesis/insurance-claims/sample-2/workdir/tests/test_claim_amount_within_coverage.
- `.py::tests.test_claim_status` — obligation `<unknown>`
  - ImportError while importing test module '/Users/yavorpanayotov/IdeaProjects/allium-4.0/eval/results/2026-05-17T17-39-02-497Z/propagate/experimental/pytest+hypothesis/insurance-claims/sample-2/workdir/tests/test_claim_status.py'.
- `.py::tests.test_complete_assessment` — obligation `<unknown>`
  - ImportError while importing test module '/Users/yavorpanayotov/IdeaProjects/allium-4.0/eval/results/2026-05-17T17-39-02-497Z/propagate/experimental/pytest+hypothesis/insurance-claims/sample-2/workdir/tests/test_complete_assessment.py'.
- `.py::tests.test_denied_claims_have_reason` — obligation `<unknown>`
  - ImportError while importing test module '/Users/yavorpanayotov/IdeaProjects/allium-4.0/eval/results/2026-05-17T17-39-02-497Z/propagate/experimental/pytest+hypothesis/insurance-claims/sample-2/workdir/tests/test_denied_claims_have_reason.py'
- `.py::tests.test_deny_claim` — obligation `<unknown>`
  - ImportError while importing test module '/Users/yavorpanayotov/IdeaProjects/allium-4.0/eval/results/2026-05-17T17-39-02-497Z/propagate/experimental/pytest+hypothesis/insurance-claims/sample-2/workdir/tests/test_deny_claim.py'.
- `.py::tests.test_incident_report` — obligation `<unknown>`
  - ImportError while importing test module '/Users/yavorpanayotov/IdeaProjects/allium-4.0/eval/results/2026-05-17T17-39-02-497Z/propagate/experimental/pytest+hypothesis/insurance-claims/sample-2/workdir/tests/test_incident_report.py'.
- `.py::tests.test_link_window` — obligation `<unknown>`
  - ImportError while importing test module '/Users/yavorpanayotov/IdeaProjects/allium-4.0/eval/results/2026-05-17T17-39-02-497Z/propagate/experimental/pytest+hypothesis/insurance-claims/sample-2/workdir/tests/test_link_window.py'.
- `.py::tests.test_mark_payout_failed` — obligation `<unknown>`
  - ImportError while importing test module '/Users/yavorpanayotov/IdeaProjects/allium-4.0/eval/results/2026-05-17T17-39-02-497Z/propagate/experimental/pytest+hypothesis/insurance-claims/sample-2/workdir/tests/test_mark_payout_failed.py'.
- `.py::tests.test_mark_payout_paid` — obligation `<unknown>`
  - ImportError while importing test module '/Users/yavorpanayotov/IdeaProjects/allium-4.0/eval/results/2026-05-17T17-39-02-497Z/propagate/experimental/pytest+hypothesis/insurance-claims/sample-2/workdir/tests/test_mark_payout_paid.py'.
- `.py::tests.test_payment_request` — obligation `<unknown>`
  - ImportError while importing test module '/Users/yavorpanayotov/IdeaProjects/allium-4.0/eval/results/2026-05-17T17-39-02-497Z/propagate/experimental/pytest+hypothesis/insurance-claims/sample-2/workdir/tests/test_payment_request.py'.
- `.py::tests.test_payment_result` — obligation `<unknown>`
  - ImportError while importing test module '/Users/yavorpanayotov/IdeaProjects/allium-4.0/eval/results/2026-05-17T17-39-02-497Z/propagate/experimental/pytest+hypothesis/insurance-claims/sample-2/workdir/tests/test_payment_result.py'.
- `.py::tests.test_payment_result_status` — obligation `<unknown>`
  - ImportError while importing test module '/Users/yavorpanayotov/IdeaProjects/allium-4.0/eval/results/2026-05-17T17-39-02-497Z/propagate/experimental/pytest+hypothesis/insurance-claims/sample-2/workdir/tests/test_payment_result_status.py'.
- `.py::tests.test_payment_service` — obligation `<unknown>`
  - ImportError while importing test module '/Users/yavorpanayotov/IdeaProjects/allium-4.0/eval/results/2026-05-17T17-39-02-497Z/propagate/experimental/pytest+hypothesis/insurance-claims/sample-2/workdir/tests/test_payment_service.py'.
- `.py::tests.test_payout` — obligation `<unknown>`
  - ImportError while importing test module '/Users/yavorpanayotov/IdeaProjects/allium-4.0/eval/results/2026-05-17T17-39-02-497Z/propagate/experimental/pytest+hypothesis/insurance-claims/sample-2/workdir/tests/test_payout.py'.
- `.py::tests.test_payout_amount_matches_claim` — obligation `<unknown>`
  - ImportError while importing test module '/Users/yavorpanayotov/IdeaProjects/allium-4.0/eval/results/2026-05-17T17-39-02-497Z/propagate/experimental/pytest+hypothesis/insurance-claims/sample-2/workdir/tests/test_payout_amount_matches_claim.p
- `.py::tests.test_payout_retry_after` — obligation `<unknown>`
  - ImportError while importing test module '/Users/yavorpanayotov/IdeaProjects/allium-4.0/eval/results/2026-05-17T17-39-02-497Z/propagate/experimental/pytest+hypothesis/insurance-claims/sample-2/workdir/tests/test_payout_retry_after.py'.
- `.py::tests.test_payout_retry_job` — obligation `<unknown>`
  - ImportError while importing test module '/Users/yavorpanayotov/IdeaProjects/allium-4.0/eval/results/2026-05-17T17-39-02-497Z/propagate/experimental/pytest+hypothesis/insurance-claims/sample-2/workdir/tests/test_payout_retry_job.py'.
- `.py::tests.test_payout_status` — obligation `<unknown>`
  - ImportError while importing test module '/Users/yavorpanayotov/IdeaProjects/allium-4.0/eval/results/2026-05-17T17-39-02-497Z/propagate/experimental/pytest+hypothesis/insurance-claims/sample-2/workdir/tests/test_payout_status.py'.
- `.py::tests.test_policy` — obligation `<unknown>`
  - ImportError while importing test module '/Users/yavorpanayotov/IdeaProjects/allium-4.0/eval/results/2026-05-17T17-39-02-497Z/propagate/experimental/pytest+hypothesis/insurance-claims/sample-2/workdir/tests/test_policy.py'.
- `.py::tests.test_policy_status` — obligation `<unknown>`
  - ImportError while importing test module '/Users/yavorpanayotov/IdeaProjects/allium-4.0/eval/results/2026-05-17T17-39-02-497Z/propagate/experimental/pytest+hypothesis/insurance-claims/sample-2/workdir/tests/test_policy_status.py'.
- `.py::tests.test_receive_incident_report` — obligation `<unknown>`
  - ImportError while importing test module '/Users/yavorpanayotov/IdeaProjects/allium-4.0/eval/results/2026-05-17T17-39-02-497Z/propagate/experimental/pytest+hypothesis/insurance-claims/sample-2/workdir/tests/test_receive_incident_report.py'.
- `.py::tests.test_register_assessor` — obligation `<unknown>`
  - ImportError while importing test module '/Users/yavorpanayotov/IdeaProjects/allium-4.0/eval/results/2026-05-17T17-39-02-497Z/propagate/experimental/pytest+hypothesis/insurance-claims/sample-2/workdir/tests/test_register_assessor.py'.
- `.py::tests.test_register_policy` — obligation `<unknown>`
  - ImportError while importing test module '/Users/yavorpanayotov/IdeaProjects/allium-4.0/eval/results/2026-05-17T17-39-02-497Z/propagate/experimental/pytest+hypothesis/insurance-claims/sample-2/workdir/tests/test_register_policy.py'.
- `.py::tests.test_routes` — obligation `<unknown>`
  - ImportError while importing test module '/Users/yavorpanayotov/IdeaProjects/allium-4.0/eval/results/2026-05-17T17-39-02-497Z/propagate/experimental/pytest+hypothesis/insurance-claims/sample-2/workdir/tests/test_routes.py'.
- `.py::tests.test_schedule_payout` — obligation `<unknown>`
  - ImportError while importing test module '/Users/yavorpanayotov/IdeaProjects/allium-4.0/eval/results/2026-05-17T17-39-02-497Z/propagate/experimental/pytest+hypothesis/insurance-claims/sample-2/workdir/tests/test_schedule_payout.py'.
- `.py::tests.test_stalled_after` — obligation `<unknown>`
  - ImportError while importing test module '/Users/yavorpanayotov/IdeaProjects/allium-4.0/eval/results/2026-05-17T17-39-02-497Z/propagate/experimental/pytest+hypothesis/insurance-claims/sample-2/workdir/tests/test_stalled_after.py'.
- `.py::tests.test_start_assessment` — obligation `<unknown>`
  - ImportError while importing test module '/Users/yavorpanayotov/IdeaProjects/allium-4.0/eval/results/2026-05-17T17-39-02-497Z/propagate/experimental/pytest+hypothesis/insurance-claims/sample-2/workdir/tests/test_start_assessment.py'.
- `.py::tests.test_submit_claim` — obligation `<unknown>`
  - ImportError while importing test module '/Users/yavorpanayotov/IdeaProjects/allium-4.0/eval/results/2026-05-17T17-39-02-497Z/propagate/experimental/pytest+hypothesis/insurance-claims/sample-2/workdir/tests/test_submit_claim.py'.
- `.py::tests.test_triage_claim` — obligation `<unknown>`
  - ImportError while importing test module '/Users/yavorpanayotov/IdeaProjects/allium-4.0/eval/results/2026-05-17T17-39-02-497Z/propagate/experimental/pytest+hypothesis/insurance-claims/sample-2/workdir/tests/test_triage_claim.py'.
- `.py::tests.test_webhooks` — obligation `<unknown>`
  - ImportError while importing test module '/Users/yavorpanayotov/IdeaProjects/allium-4.0/eval/results/2026-05-17T17-39-02-497Z/propagate/experimental/pytest+hypothesis/insurance-claims/sample-2/workdir/tests/test_webhooks.py'.

---

Coverage: 0/96 obligations (0.0%).
