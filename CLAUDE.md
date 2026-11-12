# CLAUDE.md — Opsentra

Opsentra is a UI-first AWS cloud operations and incident response platform. It is built by its sole creator, Jervil Angelo De Leon, with Claude Code.

**Source of truth:** [`OPSENTRA_MASTER_BLUEPRINT.md`](OPSENTRA_MASTER_BLUEPRINT.md). Read the relevant section before starting any work. When this file and the blueprint disagree, the blueprint wins. Flag the conflict instead of choosing silently.

## Current phase

**Phase 6: Controlled automated remediation** (blueprint §7), in progress. **Start every session by reading [`docs/phases/HANDOFF.md`](docs/phases/HANDOFF.md)**: current state, bugs to fix first, and how to run things. Phases 1–5 passed their gates on 2026-11-12: foundation, Demo Mode with Easy/Advanced views, the AWS control plane, live monitoring with the disposable Nginx lab, and incident detection, management and audit (ADR-016). The control plane stays deployed; the lab is destroyed between tests. Open items: Phase 3/4 cost check once billing catches up, and the control-plane destroy test (deferred by the owner).

Update this line when a phase gate passes. Do not start the next phase until the current gate checklist (§7.1) is reviewed with the owner.

## Hard rules (never break these)

### AWS and Terraform
- **Never run `terraform apply`, `terraform destroy`, or any AWS CLI/SDK call that creates, changes or deletes resources without explicit approval in chat for that specific command.** Read-only commands (`plan`, `validate`, `fmt`, `describe-*`, `list-*`, `get-*`) are fine.
- Default region is `ap-southeast-1`. Never touch other regions or accounts.
- Lab actions target **only** resources tagged `opsentra:lab=true` and listed in the server-side allowlist. Never write code that accepts a user-supplied ARN, hostname, URL, command or Terraform target.
- Every lab resource carries the tags `opsentra:project`, `opsentra:component`, `opsentra:environment`, `opsentra:lab` and `opsentra:expiresAt`. After any live test, verify teardown (EC2, EBS, public IPv4/EIP, security groups, alarms, log groups).
- **Cost guardrails:** no NAT gateways, load balancers, RDS, OpenSearch, EKS/ECS or always-on compute. Before adding any new AWS service, state its cost impact. The health-check schedule must be disabled whenever the lab is down.
- Terraform state lives in the S3 backend with `use_lockfile = true`. Never use DynamoDB state locking. Never commit `.terraform/`, `*.tfstate*` or `*.tfvars` containing real values.

### Security
- Never commit or print secrets, AWS keys, tokens, account IDs or credit balances. Frontend builds contain only public config (`VITE_*` values from §9.3). No Cognito client secret, ever.
- Authorization is enforced in the backend from trusted Cognito group claims. Never trust a role, user ID or permission sent in a request body or decided only in the UI.
- Privileged mutations require an `Idempotency-Key` and conditional (versioned) DynamoDB writes. Audit events are append-only.
- No SSH ingress, no arbitrary shell or SSM command endpoints, and no generic "run Terraform" button.
- Do not enter real passwords into sign-in pages. Live E2E tests read test credentials from environment variables the owner sets.

### Demo vs Live honesty
- Demo Mode uses deterministic synthetic data, never calls AWS endpoints, and always shows `DEMO — SYNTHETIC DATA`.
- Live Mode fails closed. If auth or the network is unavailable, show an error and never fall back to mock data under a Live label.
- Never mix synthetic and live data in one view or report.
- An incident is `RESOLVED` only after independent post-remediation health checks pass. SSM `Success` alone is not recovery.
- No "success" toast or status until the backend confirms the result.
- Docs and the README describe only what actually works. Planned features stay labelled as planned.

## Stack and conventions

| Area | Choice |
|---|---|
| Frontend | React + Vite + TypeScript (strict), Tailwind CSS, shadcn/ui, in `apps/dashboard/` |
| Backend | Python AWS Lambda handlers in `services/<name>/`, API Gateway HTTP API under `/v1` |
| Data | DynamoDB, separate small on-demand tables (§4.3) |
| IaC | Terraform: `infrastructure/bootstrap-state/`, `infrastructure/environments/control-plane-dev/`, `infrastructure/environments/disposable-labs/` |
| Tests | Vitest + Testing Library, pytest (moto/stubs), Playwright E2E, `terraform fmt -check` + `validate` |
| CI/CD | GitHub Actions with AWS OIDC (no static keys). PRs never write to AWS |

- **API shape:** `{data, meta}` for success and `{error: {code, message, requestId}}` for errors. Timestamps are ISO-8601 UTC. Use the status codes in §4.2.
- **Python version:** pin the Lambda runtime and local tests to the same version, and confirm AWS supports it. Lambda runs `python3.12`; run local tests with `py -3.12` (the `python` on PATH is 3.8 and must not be used). Build native dependencies in Docker or CI, not on Windows.
- **Types:** shared DTO types follow §2.4 (`Mode`, `Health`, `Severity`, `IncidentState`, …). Do not invent parallel shapes.
- **Structure:** create folders only in the phase that needs them (§8). No placeholder files.
- **Platform:** the dev machine is Windows. Scripts must run in Git Bash, or be written in Python.

## Brand and UI

- Logos, favicons and rules live in `brand/` and [`brand/BRAND_GUIDELINES.md`](brand/BRAND_GUIDELINES.md). Use the SVGs as they are: never redraw or retype the wordmark.
- **Tokens:** Ops Navy `#0B1220`, Surface `#172338`, Line `#24324A`, Signal `#38BDF8` (on dark), Signal Deep `#0284C7` (on light), Signal Ink `#0369A1` (text on light), Cloud `#F8FAFC`, Slate `#94A3B8`.
- **Status colours** (dark / light UI): healthy `#34D399` / `#047857`, warning `#FBBF24` / `#B45309`, critical `#FB7185` / `#BE123C`. Status always carries a text label, never colour alone. Never recolour the logo with status colours.
- Fonts: Inter for UI, IBM Plex Mono with tabular numerals for IDs, metrics and timestamps.
- Dark theme by default. Meet WCAG 2.2 AA contrast, provide visible focus states, and respect `prefers-reduced-motion`. Never animate the logo as a spinner.

## Workflow

- Work one phase at a time. Use plan mode for anything non-trivial, and check against the phase's Definition of Done (§10.3).
- Before calling a task done, run the relevant checks: lint, typecheck, tests, build and `terraform validate`. Report failures honestly.
- Architecture, security-scope or cost changes need an ADR in `docs/adr/` and an update to the blueprint (version + change log). Never change scope silently.
- **Git:** work on a feature branch, and commit or push only when asked. Commit messages are short and imperative (`feat:`, `fix:`, `docs:`, `infra:`, `test:`).
- **Phase complete:** update this file's "Current phase" line, the README roadmap table, and the blueprint checklist (§16).
