# Phase 3 checkpoint: AWS infrastructure foundation

- **Branch:** `feat/aws-foundation`
- **Status:** **In progress.** Deployed to `ap-southeast-1` on 2026-11-12 (with owner approval of each apply). Remaining: test users, live role tests, cost check and the teardown test.

## Gate (blueprint §7, Phase 3)

| Gate item | Evidence | Result |
|---|---|---|
| Fresh deploy works in the intended account | Bootstrap applied (7) and state migrated; control plane applied (29), 2026-11-12. Smoke: `/v1/health` 200, `/v1/me` 401 without a token and with a garbage token | **Pass** |
| Unauthorized and wrong-role requests denied | Unit: `services/api/tests/test_handler.py` (13 pass). Live: `tests/integration/test_phase3_live.py` | **Pass**: unit 13/13; live 6/6 (2026-11-12): health 200, 401 without or with a bad token, viewer/operator/admin each mapped to the right role |
| Documented state path and recovery | `docs/operations/terraform.md` (layout, recovery, never) | Written |
| No secrets in the repo | `.gitignore` (state, tfvars, backend.hcl, .env); secrets live in GitHub secrets; gitleaks workflow | Written; gitleaks runs in CI |
| Cost dashboard checked | `docs/costs/phase-3-estimate.md` (estimate); no Opsentra budget (shared account, existing budgets alert); Cost Explorer by tag after deploy | **Pending**: Cost Explorer lags about 24 h; check by the tag `opsentra:project` |
| `terraform destroy` removes disposable resources | `plan -destroy` lists all 29 control-plane resources (state bucket kept by `prevent_destroy`); a normal plan shows no drift. An actual destroy is the owner's call | **Plan verified**; live destroy not run |

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
3. ~~Approvals~~ given: bootstrap apply, state migration, control-plane apply, push, test users (2026-11-12).
4. Still open: check the cost after 24 h, and decide whether to keep the control plane running (Phase 4 needs it) or destroy it.
