# Propagation report

## Summary

- Backend: pytest+hypothesis
- Framework language: python
- Obligations total: 96
- Obligations covered: 91  (passing tests: 91)
- Bridge unresolved: 5
- Likely real failures: 0  ← human review
- Likely wrong bridges: 0  ← re-mapping
- Infrastructure gaps: 0

Runner: `python3 -m pytest --junit-xml=/var/folders/sc/gnctv8950jq16vtlllz9mcyr0000gn/T/propagate-stagec-sD9Sli/report.xml .`
Exit code: 0

## Bridge unresolved (stubs)

- `tests/test_auto_approval_scheduler.py::test_rule_failure_auto_approval_scheduler_1` — obligation `rule-failure.AutoApprovalScheduler.1`
  - bridge-unresolved
- `tests/test_auto_approval_scheduler.py::test_rule_failure_auto_approval_scheduler_2` — obligation `rule-failure.AutoApprovalScheduler.2`
  - bridge-unresolved
- `tests/test_auto_approval_scheduler.py::test_rule_failure_auto_approval_scheduler_3` — obligation `rule-failure.AutoApprovalScheduler.3`
  - bridge-unresolved
- `tests/test_claim.py::test_entity_relationship_claim_payouts` — obligation `entity-relationship.Claim.payouts`
  - bridge-unresolved
- `tests/test_policy.py::test_entity_relationship_policy_claims` — obligation `entity-relationship.Policy.claims`
  - bridge-unresolved

---

Coverage: 91/96 obligations (94.8%).
