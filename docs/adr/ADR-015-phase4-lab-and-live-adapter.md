# ADR-015: Phase 4 lab design and Live adapter

- **Status:** Agreed (2026-11-12)
- **Phase:** 4
- **Blueprint:** v1.6.0

## Context

Phase 4 must show real evidence in Live mode: a disposable Nginx lab, a probe and metric, an alarm, event ingestion, a resource registry, and the dashboard reading live data after sign-in. That has to happen within the cost and safety guardrails in CLAUDE.md: no NAT or load balancer, no always-on compute, no SSH, the probe off whenever the lab is down, and lab actions only on tagged, allowlisted resources.

## Decisions

| Area | Decision | Why |
|---|---|---|
| Lab root | `environments/disposable-labs`, its own state key, reads control-plane outputs via `terraform_remote_state` | Separate blast radius and lifetime (§9.1). |
| Network | Its own /24 VPC with one public subnet and an internet gateway; no NAT, LB or EIP | Free and isolated from the default VPC. |
| Ingress | **HTTP 80 from 0.0.0.0/0 only, no SSH**; operations through SSM | The probe Lambda runs outside a VPC with no fixed IP; putting it in a VPC would need a NAT or endpoints (cost). The page returns only a marker string. |
| Instance | t4g.nano, AL2023 arm64, IMDSv2 required, encrypted gp3, no key pair, SSM core role only | Cheapest Graviton option; SSM agent preinstalled. |
| Expiry | `lab_expires_at` is a **required input**, validated to be in the future and at most 12 hours away. It is tagged on everything (`opsentra:expiresAt`); the instance schedules its own **terminate** at that time; the probe schedule ends then too | Provider default tags cannot depend on apply-time values, so expiry is explicit. A forgotten lab stops itself. |
| Probe | One Lambda (`services/health-check`) every minute via EventBridge Scheduler. It probes the Terraform-fixed URL (no redirects followed), emits one metric (`Opsentra/Lab NginxAvailability`, dimension `Scenario`), verifies the instance is running and tagged `opsentra:lab=true`, and updates only its own registry item. If the lab is gone or expired, it writes `UNKNOWN` and **disables its own schedule** | Satisfies "no probing when the lab is down" by construction. **Inventory sync is folded into the probe** (tag and state verification each run) instead of a separate Lambda, because Phase 4 has one probed resource. |
| Alarm | `NginxAvailability < 1` for 3 of 3 one-minute periods; missing data stays *missing* | Never a fake OK when probes stop. |
| Ingestion | EventBridge rule (alarm state changes for `opsentra-lab-*`) → a CloudWatch Logs group | "Basic event ingestion logs" for Phase 4; Phase 5 adds the ingest Lambda. |
| Registry | Terraform writes the lab's two resources into `opsentra-dev-resources` (server-owned allowlist with ARN and allowed runbooks); destroy removes them | Only registered resources are probed or, later, acted on. ARNs never leave the API. |
| Fixed actions | SSM documents `Opsentra-Lab-StopNginx` and `Opsentra-Lab-RestartNginx` with no parameters | Phase 4 uses Stop for the gate test; Phase 6 runs Restart after approval. |
| API | New JWT read routes: overview, resources, incidents and timeline. The Lambda gets read-only `GetItem/Query/Scan` on three tables | Live pages read real data; still no writes. |
| Live adapter | Cognito Hosted UI, Authorization Code + PKCE (S256, state check), tokens in `sessionStorage`, a 401 signs out. Methods for later phases reject with `not-implemented`. 30-second polling in Live only; a **Stale** badge after 3 minutes | Fail-closed by design (§2.2). New public config: `VITE_COGNITO_DOMAIN`. |

## Consequences

- The lab costs about $0.011 an hour while it exists (AWS Pricing API, ap-southeast-1): t4g.nano $0.0053/h, public IPv4 $0.005/h, gp3 $0.096/GB-month. Alarms ($0.10 per month each) and the custom metric are prorated.
- If the instance terminates itself at expiry, Terraform state still lists it until the next refresh or destroy. The destroy procedure handles this.
- Tokens in `sessionStorage` can be read by XSS on this origin. The dashboard has no third-party scripts; revisit in Phase 9 (CSP).
