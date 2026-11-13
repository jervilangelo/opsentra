# ADR-018: Live Simulation Lab and guardrails

- **Status:** Agreed (2026-11-13). The owner approved Phase 7 work in chat ("I approve everything until phase 7 finished").
- **Phase:** 7
- **Blueprint:** v1.9.0

## Context

Phase 7 lets an administrator break the disposable lab on purpose from the browser, watch Opsentra detect it, and recover it, with no terminal. It must keep the project's rules:

- no arbitrary targets, commands or Terraform from the browser;
- only resources tagged `opsentra:lab=true` and registered by Terraform;
- no "success" until the backend confirms it;
- recovery means verified health, never "a command ran".

It also needs the §7 Phase 7 guardrails: preflight checks, confirmation, cooldown, one active scenario, session expiry, a watchdog for abandoned tests, and a budget disclosure.

## Decisions

| Area | Decision |
|---|---|
| Scope | **Scenario A (Nginx outage) is live.** Scenarios B (Lambda regression) and C (security group exposure) stay in Demo Mode and are shown as planned in Live. This keeps cost down, and the docs honest. |
| Catalog | Defined in code (`opsentra_incidents.lab.CATALOG`; v1 is `nginx-outage`). A scenario applies only to the one registry item with `environment = lab`, the matching `scenario` value, and a `scenarios` entry that pins the injection document **and its SHA-256 hash**. Terraform writes that entry (`Opsentra-Lab-StopNginx`). The request names only the scenario ID. |
| Where it runs | A new **lab-controller** Lambda (blueprint §4.1), invoked synchronously by the API only. The API keeps its narrow role (no SSM or EC2 calls), checks the JWT, and passes the role and username from verified claims. The body contributes only `acknowledgeImpact`. The controller holds the lab permissions: `ssm:SendCommand` on **exactly** `Opsentra-Lab-StopNginx` and `Opsentra-Lab-RestartNginx`, only on instances tagged `opsentra:lab=true`, plus the describe and status calls, which have no resource-level permissions. It gets no SNS, KMS or delete permissions (Terraform tests). |
| Preflight | Ordered checks, all re-run on the server at start. The first failure is the reason shown: <ol><li>lab deployed and registered;</li><li>no other run active;</li><li>cooldown over;</li><li>at least 30 minutes before the lab expires;</li><li>instance running and tagged as a lab;</li><li>SSM Agent online;</li><li>recovery runbook allowlisted;</li><li>no open incident on the resource;</li><li>service HEALTHY on a probe at most 3 minutes old.</li></ol> |
| Confirmation | The UI confirm dialog names the instance, the environment and the cost. The API refuses a start without `acknowledgeImpact: true` (400 `CONFIRMATION_REQUIRED`). An `Idempotency-Key` is required, and a replay returns the stored response without sending again. |
| One run, cooldown, expiry | One `LOCK` item in a new `lab-runs` table. A start takes it with a conditional update: no `activeRunId`, and `cooldownUntil` passed. This is the guard against races, not the preflight read (tested). A run lasts at most **45 minutes** (or until the lab expires). When it ends there is a **5-minute cooldown**. A run that never injected anything ends without a cooldown. |
| Start | Lock + run + audit commit in one transaction, then the hash-pinned `StopNginx` is sent once. If SSM refuses it, the run is FAILED, the lock is freed, and the API returns 502 `LAB_INJECTION_FAILED`. |
| Reset | Admin-only. It sends the allowlisted, hash-pinned `RestartNginx` and ends the active run as RESET. With no active run, it is a cleanup restart. **It never resolves an incident.** The incident still needs the independent probe: verified self-heal or the remediation verification. |
| Watchdog | Part of the reconciler (every 2 minutes), with errors isolated per run. It: <ul><li>confirms the injection through `GetCommandInvocation`, and fails the run if SSM failed or gave no result in 5 minutes;</li><li>links the incident opened after the start, and notes it on the incident timeline;</li><li>ends the run as COMPLETED when that incident is RESOLVED or CLOSED;</li><li>at the time limit, sends the allowlisted restart and ends the run as EXPIRED;</li><li>ends runs whose instance is gone or stopped, with no command;</li><li>releases a lock that names a run that is not active.</li></ul> |
| Audit | Every step is appended under `LAB#<scenarioId>` (target type `LAB`): <ul><li>`LAB_SCENARIO_STARTED`;</li><li>`LAB_INJECTION_SENT`;</li><li>`LAB_FAULT_INJECTED`;</li><li>`LAB_SCENARIO_{COMPLETED,RESET,EXPIRED,FAILED}`;</li><li>`LAB_RESET`;</li><li>`LAB_{START,RESET}_DENIED`.</li></ul> The linked incident gets `LAB_SCENARIO_LINKED` and `LAB_SCENARIO_ENDED` notes (outcome INFO), so the timeline says the incident was a test. `GET /v1/audit` includes the lab partition. |
| API | `GET /v1/labs` (Admin) returns the scenario with `preflight`, `activeRun` or `lastRun`, `cooldownUntil` and `labExpiresAt`. `POST /v1/labs/{scenarioId}/start` and `POST /v1/labs/{scenarioId}/reset` are Admin only, and the controller enforces that too. There are three new routes, 20 in total, and every one except `/v1/health` needs a JWT. |
| Teardown | No Terraform from the browser. The lab is still created and destroyed with `terraform apply` and `terraform destroy` after owner approval. **Automation:** <ul><li>the instance terminates itself at `lab_expires_at`;</li><li>the probe schedule ends then;</li><li>the watchdog ends runs on a vanished lab;</li><li>`scripts/gate/verify_teardown.py` checks everything is gone (read-only): EC2, EBS, EIPs, public IPv4, security groups, VPCs, alarms, log groups, schedules, registry items and active runs.</li></ul> |
| UI | In Live, the Simulation Lab page is admin-only and shows: <ul><li>the preflight checklist (each check with a text label: "Passed" or "Failed", never colour alone);</li><li>the target and the lab expiry;</li><li>the cost disclosure;</li><li>start and reset dialogs;</li><li>the active run with its incident link and auto-reset time.</li></ul> When the lab is not deployed it says so, and offers Demo Mode. It never shows synthetic data in Live. Success toasts appear only after the API confirms. |

## Consequences

- The API role still never calls SSM or EC2. The lab-controller role is the only one able to send `StopNginx` from a user action, and only to a lab-tagged instance.
- The reconciler already had `SendCommand` on `Opsentra-Lab-*` (ADR-017). It now also uses it for the expiry restart. No new permissions apart from the `lab-runs` table.
- **Cost:** one small on-demand DynamoDB table (a few writes per run) and one Lambda (a few invocations per run). SSM Run Command on EC2 is free. All of it is within the free tiers. The lab's own cost is unchanged: about US$0.01–0.02 per hour while deployed.
- A run's incident is linked by resource and time: the first active incident on the resource opened after the start. The preflight refuses a start while any incident on the resource is open, so the link cannot pick up an older one.
- Scenarios B and C remain planned for Live. Their registry entries (`regression`) carry no `scenarios` pin, so no Live action can target them (Terraform test).
