# ADR-014: Phase 3 AWS foundation choices

- **Status:** Agreed (2026-11-12)
- **Phase:** 3
- **Blueprint:** v1.5.0 (ADR-006, ADR-007, ADR-008 move from Proposed to Agreed)

## Decisions

| Area | Decision | Why |
|---|---|---|
| Lambda runtime | `python3.12` on arm64, 128 MB, 5 s, stdlib only | 3.12 is installed locally (`py -3.12`) and supported by Lambda, so tests and runtime match (CLAUDE.md). No native dependencies to build. |
| State | One S3 bucket, versioned, SSE-S3, TLS-only, public access blocked, `prevent_destroy`; `use_lockfile = true`; partial backend config in gitignored `backend.hcl` | Blueprint §9.1. The bucket name contains the account ID, which must not be committed. |
| Encryption | AWS-owned keys (DynamoDB), SSE-S3 (state), CloudWatch default; no customer-managed KMS keys | Each KMS key costs about $1 a month. Nothing stored yet needs a customer key. Revisit in Phase 9. |
| Auth | Cognito user pool on the **Lite** tier, admin-only sign-up, groups viewer/operator/admin, a public browser client (code + PKCE, no secret) and an integration-test client (AdminInitiateAuth only) | Blueprint §5, §9.3. The test client needs IAM credentials to use, so it cannot be used from a browser. Test users are created by a script, so no passwords enter Terraform state. |
| API | HTTP API with a JWT authorizer (issuer = pool, audience = both client IDs); `/v1/health` public, `/v1/me` JWT; stage throttle burst 10 / rate 5; access logs | Blueprint §4.2. The handler accepts only access tokens and reads roles only from `cognito:groups`. |
| Least privilege | The API Lambda can only write its own logs; **no DynamoDB access until Phase 5** | Nothing in Phase 3 reads or writes tables. |
| Tables | The five §4.3 tables, on-demand, PITR off, deletion protection off, names prefixed `opsentra-dev-` | Low cost, destroyable dev environment. The `-dev` prefix keeps room for other environments. |
| CI identity | GitHub OIDC with one **read-only plan role**, trusted only for this repo's pull requests and `main`; plans run with `-lock=false` | PRs never write to AWS. Deploys stay manual, with owner approval, until a gated deploy workflow exists. |
| Cost alerts | **No Opsentra budget by default** (`create_budget = false`). The account is shared with other projects and already has five budgets, including a monthly cost budget and a zero-spend budget. The optional module ($5, credits excluded, 20/60/100 % actual and 100 % forecast) stays available. | An account-wide Opsentra budget would count other projects' spend; a tag-filtered one needs the cost allocation tag activated first. Opsentra cost is tracked in Cost Explorer by the tag `opsentra:project`. Budgets are not a spending cap (§11). |
| Static checks | `terraform test` with mocked providers (no AWS), checkov with documented exceptions, gitleaks | Fast, credential-free checks on every PR. |

## Consequences

- **Reserved concurrency is not set.** New accounts can have a total concurrency limit of 10. API Gateway throttling caps the load instead.
- **Frontend sign-in and the authenticated Live adapter are Phase 4**, as in the blueprint.
- **Checkov exceptions** are listed in `docs/security/checkov-exceptions.md`.
