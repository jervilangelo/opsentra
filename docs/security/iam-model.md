# IAM and identity model (Phases 3–9)

## Principals

| Principal | How it authenticates | What it can do | Guardrails |
|---|---|---|---|
| Owner (local) | `aws login` / SSO, short-lived | Runs Terraform plan; apply/destroy only after approving the exact command | Terraform `allowed_account_ids`, region validation |
| `opsentra-dev-api-role` (Lambda) | Lambda service, `aws:SourceAccount` condition | Own logs; read named tables; conditional `PutItem`/`UpdateItem`/`ConditionCheckItem` on incidents, audit, correlations and remediations; `lambda:InvokeFunction` on the coordinator and the lab controller only; `cloudwatch:GetMetricStatistics` (Phase 8, read-only, no resource-level support) | No `DeleteItem`, no SSM or EC2; the metric read is the only wildcard (tested) |
| `opsentra-dev-incident-ingest-role` (Lambda) | Lambda service | Incident tables (no delete), read the registry, publish to the alert topic, its DLQ | No SSM (tested) |
| `opsentra-dev-incident-reconciler-role` (Lambda) | Lambda service | As ingest, plus `cloudwatch:DescribeAlarms` on `opsentra-lab-*` alarms, the `lab-runs` table (watchdog), and the runbook statements below (backstop dispatch, lab expiry restart) | Same as the coordinator |
| `opsentra-dev-remediation-coordinator-role` (Lambda) | Lambda service | Incident tables (no delete); `ssm:SendCommand` only on **`document/Opsentra-Lab-RestartNginx`** (Phase 9; was the `Opsentra-Lab-*` prefix) and instances tagged `opsentra:lab=true`; `ssm:GetCommandInvocation`, `ec2:DescribeInstances` (no resource-level support) | Can never send the fault-injection document; no sessions, automations, document changes or instance lifecycle actions (tested); the code re-checks the registry, document hash and tag before sending |
| `opsentra-dev-lab-controller-role` (Lambda, Phase 7) | Lambda service; invoked only by the API role | `lab-runs` and incident tables (no delete); `ssm:SendCommand` on exactly `Opsentra-Lab-StopNginx` and `Opsentra-Lab-RestartNginx`, only on `opsentra:lab=true` instances; `DescribeInstanceInformation`, `GetCommandInvocation`, `DescribeInstances` | No SNS, KMS, delete, session, document or instance-lifecycle rights (tested); preflight, lock and hash checks in code (ADR-018) |
| `opsentra-dev-gha-plan` (GitHub Actions) | OIDC from `token.actions.githubusercontent.com`, aud `sts.amazonaws.com` | `ReadOnlyAccess`, read the state bucket; **explicitly denied** writing state | Trust only for `repo:jervilangelo/opsentra:pull_request` and `:ref:refs/heads/main`, exact match (tested); 1-hour sessions |
| Dashboard users | Cognito, Authorization Code + PKCE (Phase 4) | Call the API with an access token | Roles only from `cognito:groups`; no self sign-up |
| Integration tests | `AdminInitiateAuth` with the owner's IAM credentials | Get tokens for the three test users | The client allows only admin auth, so it cannot be used from a browser |

## Roles in the application (§5.2)

The API maps the Cognito groups `viewer`, `operator` and `admin` to roles, taking the highest group. A role, user ID or permission sent in the body, query or a custom claim is ignored (unit-tested). `/v1/me` returns the role and its permitted actions:

| Role | Permitted actions |
|---|---|
| VIEWER | `read:live`, `read:audit:limited` |
| OPERATOR | + `incident:acknowledge`, `incident:investigate`, `incident:close`, `remediation:request` |
| ADMIN | + `remediation:decide`, `lab:start`, `lab:reset`, `read:audit:full` |

## Tests that guard this

- `services/api/tests/test_handler.py`: 401 without a token or with an ID token, 403 without a trusted group, role from groups only, forged body role ignored.
- `infrastructure/environments/control-plane-dev/tests/control_plane.tftest.hcl`: JWT on every route except health, Lambda role logs-only, OIDC trust pinned to the exact repo with no `StringLike`, plan role read-only with a state-write deny, browser client with no secret and code flow only.
- `services/api/tests/integration/test_phase3_live.py` (after deploy): real 401 without a token and real role mapping for all three users.

## Known limitation: authorizer error format

When the token check fails (no token, an expired or malformed token), API Gateway rejects the request before the Lambda runs and returns `401 {"message":"Unauthorized"}`. That is not the blueprint's `{error: {code, message, requestId}}` envelope, and HTTP APIs cannot customise it. Clients must treat any 401 as "sign in again". Errors raised by the API itself (403, 404, 409, 5xx) use the standard envelope.

## Phase 9 audit (2026-11-13)

- **Drift:** `terraform plan` for the control plane reported no changes, so live IAM equals the code.
- **IAM Access Analyzer:** `validate-policy` returned no findings for all 7 inline policies.
- **F4 (fixed):** the coordinator and reconciler could send any `Opsentra-Lab-*` document, including the fault-injection one. They are now limited to `RestartNginx`, with a Terraform test that fails if either references `StopNginx` or the prefix.
- **F3 (accepted):** the CI plan role uses `ReadOnlyAccess`, which can read data. The trust is exact (this repo's PRs and `main`), and fork PRs get no token. Revisit if collaborators are added.
