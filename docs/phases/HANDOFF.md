# Session handoff (read this first)

> Last updated: **2026-11-13, end of session.** Update this file at the end of every working session.

## Where we are

| | |
|---|---|
| **Phase** | **6 and 7 both built and tested locally; neither live gate has run.** The owner asked to continue into Phase 7 (2026-11-13) and approved every step up to Phase 7's end, AWS writes included. Phase 6 is **not** marked complete: its live gate is still pending. |
| **Phases complete** | 1–5 (gates passed and approved by the owner on 2026-11-12). |
| **Branch** | `feat/remediation`. Commit `884bacb` (Phase 6 fixes) and the Phase 7 commit are **local and not pushed**. `main` has Phase 6 up to `fa87a56`. |
| **AWS now** | Unchanged since 2026-11-12. **Control plane deployed with the old Phase 6 code** (bug 1 still live: the reconciler raises on `INC-20261112-1838F3` every 2 minutes). **Lab destroyed.** |
| **Blocker** | **The AWS CLI session expired.** The owner must run `aws login`; no AWS command, including `terraform plan`, works until then. |
| **Source of truth** | `OPSENTRA_MASTER_BLUEPRINT.md` (**v1.9.0**) and `CLAUDE.md`. Designs: `docs/adr/ADR-017-approved-remediation.md`, `docs/adr/ADR-018-live-simulation-lab.md`. Evidence: `docs/phases/phase-6-checkpoint.md`, `docs/phases/phase-7-checkpoint.md`. |

## Next: one live session finishes both gates

Follow `docs/phases/phase-7-checkpoint.md` → "Live gate plan". In short:
1. `aws login` (owner).
2. Run the control-plane plan and check it shows only the expected changes:
   - the `lab-runs` table;
   - the `lab-controller` Lambda, role, policy and log group;
   - 3 API routes;
   - Lambda code and environment updates;
   - IAM updates.

   Then apply.
3. Confirm `INC-20261112-1838F3` escalates.
4. Deploy the lab.
5. Phase 6: the happy path to RESOLVED, then self-approval plus false success, which must end ESCALATED.
6. Phase 7: `scripts/gate/live-lab.cjs`, covering:
   - start → incident → approved recovery → COMPLETED;
   - a start during cooldown is refused;
   - start → reset;
   - attack checks;
   - destroy with a run active, which the watchdog must end.
7. Destroy the lab and run `scripts/gate/verify_teardown.py`.
8. Record the evidence, commit, push, and ask for the Phase 6 and Phase 7 gate reviews.

## Phase 6 bugs from live run 1 (fixed in code, not deployed)

1. **Escalation writes used invalid DynamoDB syntax.** `SET …, REMOVE activeRequestId` became `SET … REMOVE activeRequestId` (`_incident_update(remove=[...])`). The incident tests now check every `UpdateExpression` against DynamoDB's grammar (`conftest.check_update_expression`) because moto is lax.
2. **Verification could never pass** when the probe streak began just before SSM reported Success. It now uses `start = max(healthyStreakSince, completedAt)`, needs an unbroken streak of 3 or more, and `lastCheckedAt ≥ start + 2 min`.
3. **The reconciler (and the new lab watchdog) isolate errors per item**, so one bad incident or run no longer blocks the rest.

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
  - `replay_events.py` replays the Phase 5 ingest duplicate, malformed and out-of-order events;
  - `live-lab.cjs <outDir> start|watch|reset|shot` drives the Live Simulation Lab as the admin test user (Phase 7);
  - `verify_teardown.py` (read-only) prints what is left of the lab and exits 0 only when nothing is.
- **Lab failure injection** (allowlisted SSM documents):

  ```
  aws ssm send-command --document-name Opsentra-Lab-StopNginx --instance-ids <id>
  aws ssm send-command --document-name Opsentra-Lab-RestartNginx --instance-ids <id>
  ```
- **checkov:** a throwaway venv (`py -3.12 -m venv`, `pip install checkov`), then `python -m checkov.main -d infrastructure --framework terraform --quiet --compact`. The last result (2026-11-13) was 202 passed, 0 failed.

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
