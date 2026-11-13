# ADR-017: Approved remediation (request, approval, coordinator, verification)

- **Status:** Agreed (2026-11-12)
- **Phase:** 6
- **Blueprint:** v1.8.0

## Context

Phase 6 must let a signed-in user recover a real Nginx failure from the browser. The constraints are:

- No arbitrary targets or commands.
- An administrator's approval.
- Exactly one execution per approval, even when requests are replayed.
- No "recovered" state just because SSM reported `Success`.

The blueprint (§3.5) prefers a simple Lambda and DynamoDB coordinator before Step Functions.

## Decisions

| Area | Decision |
|---|---|
| Catalog | Runbooks are defined in code (`opsentra_incidents.remediation.CATALOG`; v1 is `rb-restart-nginx`). A runbook applies to a resource only when the resource's registry item (written by Terraform) lists it with the same document name **and its SHA-256 hash**. The coordinator sends `DocumentHash`, so a changed document is refused by SSM. |
| Request (Operator+) | The body carries only `runbookId` (validated pattern), `expectedVersion` and `reason`. The resource, instance and document come from server data. The incident goes to AWAITING_APPROVAL. The request is PENDING for 15 minutes. One transaction covers the incident version check, the request put and the audit append. An `Idempotency-Key` is required. |
| Decision (Admin) | Approve: APPROVED, and the incident goes to REMEDIATING. Reject: REJECTED, and the incident goes to ESCALATED. A request decided after `expiresAt` gives 409 `APPROVAL_EXPIRED` and is closed as REJECTED with "Approval expired". A replay returns the stored response and never dispatches again. |
| Self-approval | **Allowed (owner decision)**, but stored as `selfApproved` on the request and its audit item, and shown as "Self-approved" in the UI. |
| Coordinator | Lambda `opsentra-dev-remediation-coordinator`, invoked asynchronously by the API after an approval commits (payload `{requestId}` only). It first takes a **conditional lock**: APPROVED → RUNNING with no `executionId`. It then re-checks the registry entry and pinned hash, and that the instance is tagged `opsentra:lab=true` and running. Only then does it send the command once. Any failure means FAILED with a sanitised summary, and the incident goes to ESCALATED. It never resends. |
| Status | An EventBridge rule in the lab root ("EC2 Command Status-change Notification" for the lab's restart document) invokes the coordinator. `Success` makes the request SUCCEEDED and moves the incident to **VERIFYING**, not RESOLVED. `Failed`, `TimedOut` or `Cancelled` make it FAILED and move the incident to ESCALATED. |
| Verification | **Owner decision:** 3 consecutive HEALTHY probes, all after the command completed, and the alarm OK, lead to RESOLVED. Without that within 10 minutes, the incident goes to ESCALATED (`VERIFICATION_FAILED`). The probe keeps `healthyStreak` and `healthyStreakSince` on the registry item. **Rule as implemented (v1.8.1, after live run 1):** with `start = max(healthyStreakSince, completedAt)`, the resource must be HEALTHY with an unbroken `healthyStreak ≥ 3` and `lastCheckedAt ≥ start + 2 min`. At the 1-minute probe cadence that is at least 3 healthy probes after the fix finished. The earlier check (`healthyStreakSince > completedAt`) could never pass when the streak began a second before SSM reported Success, which happened live. |
| Backstop | The reconciler runs every 2 minutes (was 5). It: <ul><li>expires PENDING requests;</li><li>dispatches APPROVED requests the coordinator never picked up (the lock keeps this to one);</li><li>polls `GetCommandInvocation` for RUNNING requests after 3 minutes;</li><li>fails RUNNING requests after 10 minutes or without a command ID.</li></ul> |
| IAM | `ssm:SendCommand` only on `document/Opsentra-Lab-*` and on instances with `ssm:resourceTag/opsentra:lab = true`, for the coordinator and reconciler only. `GetCommandInvocation` and `DescribeInstances` use `*` because they have no resource-level permissions. The API may invoke only the coordinator and never calls SSM or EC2. There is still no `DeleteItem` anywhere (Terraform tests). |
| Denied attempts | A 403 or 409 on any privileged command appends `<ACTION>_DENIED` (outcome DENIED, actor, role, code) to the incident's audit trail. This is written only for incidents that exist, so made-up IDs create nothing. |

## Consequences

- One runbook is live. Others in the Demo catalog, such as the Lambda alias rollback, are not registered in Live until their phase.
- A Lambda crash between the lock and the send leaves the request RUNNING without a command. The reconciler fails it after 3 minutes and does not retry: "do not retry blindly" (§12).
- **Cost:** SSM Run Command on EC2 and the AWS service events rule are free. The coordinator runs a few invocations per test, and the reconciler about 21,600 per month, both inside the Lambda free tier.
