# Operations runbooks

Procedures for the Opsentra control plane and the disposable lab. Commands are for Git Bash on Windows; always mask account IDs (`sed -E 's/[0-9]{12}/<account>/g'`). **Every command that creates, changes or deletes AWS resources needs the owner's approval for that specific command** (CLAUDE.md).

## 1. Run a live demo or test

1. **Before:** run `aws login`. Check that the control-plane plan is clean: `terraform plan` in `infrastructure/environments/control-plane-dev` should report no changes.
2. **Deploy the lab** (approval needed):

   ```bash
   EXP=$(date -u -d '+4 hours' +%Y-%m-%dT%H:%M:%SZ); echo "$EXP" > .lab_expires_at
   terraform plan -var "lab_expires_at=$EXP" -out=lab.tfplan
   terraform apply lab.tfplan
   ```

   The lab is ready when the probe reports HEALTHY and SSM is Online, after about 1–2 minutes.
3. **Break it:** in the Live UI, open Simulation Lab and run *Start live scenario* (admin). All 9 preflight checks must pass first.
4. **Recover it:** on the incident page, the operator requests "Restart Nginx" and an admin approves. The incident is RESOLVED only after 3 healthy probes.
5. **After:** run the teardown below. Never leave the lab running unattended. It terminates itself at `lab_expires_at`, but its log groups and alarm remain until `destroy`.

## 2. Teardown and verification

```bash
cd infrastructure/environments/disposable-labs
terraform plan -destroy -var "lab_expires_at=$(cat .lab_expires_at)" -out=destroy.tfplan
terraform apply destroy.tfplan                          # approval needed
cd ../../.. && services/api/.venv/Scripts/python.exe scripts/gate/verify_teardown.py   # read-only
```

`verify_teardown.py` must print `TEARDOWN VERIFIED`. It checks:

- **Compute and network:** EC2, EBS, EIPs, public IPv4, security groups, VPCs.
- **Monitoring:** alarms, log groups, schedules.
- **Opsentra data:** registry items, active lab runs.

If anything is left, run `destroy` again. If it still remains, delete that one resource by hand after approval, and record it.

## 3. An incident is stuck

| Symptom | Check | Action |
|---|---|---|
| VERIFYING for more than 10 minutes | Reconciler logs (CloudWatch link on the incident page); probe health on Infrastructure | The reconciler escalates after 10 minutes. If it doesn't, look for `"errors"` in its `reconcile` log line |
| ESCALATED after a remediation | The incident timeline: `VERIFICATION_FAILED` or `REMEDIATION_FAILED` | **Do not retry blindly.** Check the SSM command output and the probe. Fix the cause, then request the runbook again |
| OPEN but the lab is gone | `verify_teardown.py` | Expected: no probe and no alarm, so it can't self-heal. Leave it; it records a test that ended with the lab |
| A lab run still ACTIVE | Simulation Lab page (Live) | Use *Reset scenario*, or wait: the watchdog ends it at its time limit, or within 2 minutes once the lab is gone |

## 4. Messages in a dead-letter queue

The dashboard `opsentra-dev-operations` shows DLQ depth.

```bash
for q in $(aws sqs list-queues --queue-name-prefix opsentra --query QueueUrls --output text); do
  aws sqs get-queue-attributes --queue-url "$q" --attribute-names ApproximateNumberOfMessages --query Attributes --output text; done
```

- **Ingest DLQ:** an alarm event failed every retry. The reconciler opens any missed incident from the alarm state within 2 minutes, so check that the incident exists before replaying anything.
- **Coordinator DLQ:** an approval or SSM status event failed. The reconciler dispatches approved requests and polls SSM status, so the message is evidence, not a lost action.

Keep the messages for 14 days for diagnosis; do not purge them without noting why.

## 5. Investigate with logs

Every pipeline Lambda logs one JSON line per action with `incidentId`, `requestId`, `runId` and `awsRequestId` (ADR-019). The incident page links to the right log groups, already filtered. In Logs Insights, across the four pipeline log groups:

```
fields @timestamp, service, msg, incidentId, requestId, outcome, incidentState
| filter incidentId = "INC-…"
| sort @timestamp asc
```

## 6. Suspected credential or token compromise

1. **Revoke sessions now:** `aws cognito-idp admin-user-global-sign-out --user-pool-id <pool> --username <user>` (approval needed). Access tokens stop working within their 60-minute lifetime; refresh tokens are revoked at once.
2. **If it's an admin:** disable the user (`admin-disable-user`) and check the audit page for actions by that user.
3. **AWS keys:** the project uses none; CI uses OIDC. If an owner key leaked, deactivate it in IAM first, then rotate.
4. **Repository:** run `scripts/security/scan_secrets.py` (full history), and check the gitleaks CI result.

## 7. Security checks to repeat

| When | Run |
|---|---|
| After any API or IAM change | `scripts/security/probe_api.py` (read-only) |
| Before a release | `scan_secrets.py`, `npm audit --omit=dev`, `pip-audit`, checkov, `terraform test` |
| After a live test | `verify_teardown.py` |
| When latency looks off | `scripts/security/latency_check.py`, then the API access-log `latencyMs` (server-side) |
