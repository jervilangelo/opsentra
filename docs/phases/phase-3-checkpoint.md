# Phase 3 checkpoint: AWS infrastructure foundation

- **Branch:** `feat/aws-foundation`
- **Status:** **In progress.** The code is written and passes every local check. **Nothing is deployed yet**: deployment needs the owner's AWS credentials, a billing check, and approval of each apply.

## Gate (blueprint §7, Phase 3)

| Gate item | Evidence | Result |
|---|---|---|
| Fresh deploy works in the intended account | `docs/operations/terraform.md` steps 1–2 | **Pending deploy** |
| Unauthorized and wrong-role requests denied | Unit: `services/api/tests/test_handler.py` (13 pass). Live: `tests/integration/test_phase3_live.py` | Unit pass; **live pending** |
| Documented state path and recovery | `docs/operations/terraform.md` (layout, recovery, never) | Written |
| No secrets in the repo | `.gitignore` (state, tfvars, backend.hcl, .env); secrets live in GitHub secrets; gitleaks workflow | Written; gitleaks runs in CI |
| Cost dashboard checked | `docs/costs/phase-3-estimate.md` (estimate); no Opsentra budget (shared account, existing budgets alert); Cost Explorer by tag after deploy | **Pending deploy** |
| `terraform destroy` removes disposable resources | Destroy procedure plus verification commands | **Pending deploy** |

## Local checks (2026-11-12)

| Check | Result |
|---|---|
| `py -3.12 -m pytest` (services/api) | 13 passed, 6 skipped (live tests without env vars) |
| `ruff check` / `ruff format --check` | Clean |
| `terraform fmt -check -recursive` | Clean |
| `terraform validate` (both roots) | Valid |
| `terraform test` (mocked providers) | control-plane 9/9, bootstrap 2/2 |
| `checkov` with documented skips | 59 passed, 0 failed |
| Provider lock | Windows, Linux and macOS hashes committed |

## What the deploy needs from the owner

1. ~~`aws login` for `ap-southeast-1`~~ done (IAM user, 2026-11-12).
2. ~~Billing → Credits checked~~ confirmed by the owner (2026-11-12).
3. Approval of each command: bootstrap apply, state migration, control-plane apply, test-user creation, and later the destroy test.
