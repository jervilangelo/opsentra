# Session handoff (read this first)

> Last updated: **2026-11-13, mid-session.** Update this file at the end of every working session.

## Where we are

| | |
|---|---|
| **Phase** | **6: Controlled automated remediation**. In progress, live gate partly done. |
| **Phases complete** | 1–5 (gates passed and approved by the owner on 2026-11-12). |
| **Branch** | `feat/remediation`, fast-forwarded into `main` and pushed. |
| **AWS now** | **Control plane deployed** with Phase 6. **Lab destroyed**, teardown verified at 08:58 UTC (EC2, EBS, EIP, VPC, SGs, alarms, log groups, probe schedule, registry, rules all 0). |
| **Source of truth** | `OPSENTRA_MASTER_BLUEPRINT.md` (v1.8.0) and `CLAUDE.md`. Design for this phase: `docs/adr/ADR-017-approved-remediation.md`. Evidence: `docs/phases/phase-6-checkpoint.md`. |

## Two bugs found by the live gate test

> **2026-11-13: bugs 1 and 2 fixed in code (uncommitted on `feat/remediation`), not yet deployed.** `_incident_update` takes `remove=[...]`; `verify()` uses `_verified_after()`; the reconciler isolates errors per incident and request. The incident tests now check every `UpdateExpression` against DynamoDB's grammar (conftest `check_update_expression`), which fails on the old code. Incidents 79 passed, API 48 (+6 live skipped), health-check 16, ruff clean. ADR-017 and blueprint v1.8.1 updated. **Next:** the AWS CLI login had expired, so the control-plane plan has not run; then step 3.

1. **Escalation writes are invalid DynamoDB syntax (serious).**
   - **Where:** `services/incidents/src/opsentra_incidents/remediation.py`, `_incident_update(...)`. It is called with `extra_sets="REMOVE activeRequestId"`, which builds `SET #s = :to, version = …, REMOVE activeRequestId`.
   - **Effect:** real DynamoDB rejects it (`ValidationException … token: "REMOVE"`). moto accepted it, which is why the unit tests passed. Every escalation path fails: reject, approval expiry, failed SSM, and verification failure.
   - **Live impact:** the reconciler raises on incident `INC-20261112-1838F3` (stuck in VERIFYING) every 2 minutes, which **stops the rest of each reconcile run**.
   - **Fix:**
     - give `_incident_update` a separate `remove: list[str]` argument, appended as ` REMOVE …` after the SET clause;
     - add a unit test that checks the generated `UpdateExpression` text, because moto is lax;
     - make `reconciler.run` catch errors per incident and request, so one bad item can't block the whole run.
2. **Verification can never pass when the streak starts just before SSM reports success.**
   - **What happened live:** the probe's healthy streak began at 08:42:23, but the command's `completedAt` was 08:42:24.
   - **Why it blocks:** `verify()` needs `healthyStreakSince > completedAt`, so a genuine recovery waits forever and would escalate.
   - **Fix:** with `start = max(healthyStreakSince, completedAt)`, require `healthyStreak ≥ 3` (unbroken), HEALTHY, the alarm OK, and `lastCheckedAt ≥ start + 2 min`. At the 1-minute probe cadence that is at least 3 healthy probes, all after the fix finished. Update the unit tests, ADR-017 and the blueprint §4.3 note to match.
3. **Then deploy the fix and repair the stuck incident.**
   - **Deploy (needs owner approval):** a control-plane `terraform plan` / `apply`, which changes Lambda code only.
   - **Expected after deploy:** the reconciler escalates `INC-20261112-1838F3`, because its lab no longer exists. That is correct; record it.

## Live gate status (Phase 6)

| Gate item | Status | Evidence |
|---|---|---|
| Genuine failure recovered without CLI | **Partly.** Request (operator, UI), approval (admin, UI), one SSM command and SSM Success → VERIFYING all worked. **RESOLVED was not reached** (bug 2). | Timeline in `docs/phases/phase-6/screenshots/` |
| Unauthorized and arbitrary operations denied | **Pass.** No token → 401. Viewer/operator decision → 403. Role in body → 403. Viewer request → 403. Forged runbook IDs → 400. Second request while pending → 409. Unknown request → 404. Stale version → 409. Every refusal is audited as `*_DENIED`. The API rate limit also returned 429 under the burst. | Checkpoint |
| Replay does not repeat the action | **Pass.** Re-sent decision → 409. Two direct coordinator re-invokes → `skipped`. Exactly **one** SSM command for the request. | Checkpoint |
| SSM success never marks recovered | **Not yet run live.** The plan: request and **self-approve** as admin, then stop Nginx right after the restart. Expect ESCALATED, never RESOLVED. Bug 1 must be fixed first. | n/a |

**Remaining gate steps** (each needs the owner's approval, as every AWS write does):
- deploy the fixes;
- deploy the lab and re-run the happy path to RESOLVED;
- run the self-approval plus false-success run;
- destroy the lab and verify teardown;
- record the evidence, then ask for the gate review.

## How to run things (Windows, Git Bash)

- **Terraform:** `export PATH="$PATH:/c/Users/Jervil/AppData/Local/Microsoft/WinGet/Links"`.
- **Roots:** `infrastructure/environments/control-plane-dev` and `.../disposable-labs`.
- **Lab plan:** `EXP=$(date -u -d '+4 hours' +%Y-%m-%dT%H:%M:%SZ)`, then `terraform plan -var "lab_expires_at=$EXP" -out=lab.tfplan`. The same `EXP` is needed for the destroy plan; it is saved in the gitignored `.lab_expires_at`.
- **AWS CLI:** prefix with `MSYS_NO_PATHCONV=1` when an argument starts with `/`. **Always mask account IDs** with `sed -E 's/[0-9]{12}/<account>/g'`.
- **Python:** `services/api/.venv/Scripts/python.exe` (3.12; it has boto3, moto, pytest and ruff) runs the tests in `services/api`, `services/incidents` and `services/health-check`. Never use the PATH `python` (3.8).
- **Dashboard:**
  - unit tests: `node scripts/run-vitest.mjs run` (from `apps/dashboard`);
  - E2E: `npx playwright test`;
  - also `npx tsc -b --noEmit`, `npx eslint src` and `npm run build`;
  - the dev server `npm run dev` must be running on :5173 for the Live UI gate scripts.
- **Test users:**
  - credentials are in the gitignored `services/api/.env.test`;
  - load them with `set -a; . services/api/.env.test; set +a`;
  - never print them, and never type real passwords into sign-in pages.
- **Gate helper scripts** (`scripts/gate/`):
  - `live-remediate.cjs <outDir> <incidentId> request|approve|self|watch|shot` drives the Live UI as the test users;
  - `attack_replay.py <incidentId> <requestId> attacks|replay` runs the API attack and replay checks;
  - `replay_events.py` replays the Phase 5 ingest duplicate, malformed and out-of-order events.
- **Lab failure injection** (allowlisted SSM documents):

  ```
  aws ssm send-command --document-name Opsentra-Lab-StopNginx --instance-ids <id>
  aws ssm send-command --document-name Opsentra-Lab-RestartNginx --instance-ids <id>
  ```
- **checkov:** a throwaway venv (`py -3.12 -m venv`, `pip install checkov`), then `python -m checkov.main -d infrastructure --framework terraform --quiet --compact`. The last result was 191 passed, 0 failed.

## Open items carried over

- **Phase 3–6 cost check** in Cost Explorer once billing data arrives. The owner should activate the `opsentra:project` cost allocation tag.
- **Control-plane destroy test:** deferred by the owner.
- **SNS alert email subscription:** still *PendingConfirmation*. The owner needs to click the AWS confirmation email, or alerts are not delivered.
- **Phase 6 completion:** after the gate passes and the owner approves, update the CLAUDE.md "Current phase", the README roadmap and badge, and blueprint §16 and the version history.

## Owner decisions in force

- **Easy view** is the default.
- **Severity** is shown as "SEV-n · Word".
- **No Opsentra AWS budget:** the account is shared.
- **Keep the control plane up;** the lab is destroyed between tests.
- **Phase 5 self-heal:** alarm OK plus a HEALTHY probe at least 2 minutes after the clear.
- **Phase 6:**
  - the same Admin may request and approve, flagged `selfApproved`;
  - verified recovery is 3 consecutive healthy probes after the fix finished, with the alarm OK;
  - otherwise ESCALATED after 10 minutes.
- **Approvals:** ask the owner before every AWS write, commit or push, and report results honestly.
