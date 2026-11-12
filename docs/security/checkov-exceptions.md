# Checkov exceptions

`infrastructure/.checkov.yaml` skips the checks below. Each skip is a deliberate decision (ADR-014), not an oversight. Review them all in Phase 9.

| Check | What it wants | Why it is skipped | Revisit when |
|---|---|---|---|
| CKV_AWS_158 | KMS key on CloudWatch log groups | Logs hold no secrets; a customer key costs about $1 a month | Logs carry sensitive data |
| CKV_AWS_119 | KMS customer key on DynamoDB | AWS-owned key encryption is on by default | Real customer data (never planned) |
| CKV_AWS_145 | KMS default encryption on the state bucket | SSE-S3 (AES256) is on; access is tightly scoped | A compliance requirement appears |
| CKV_AWS_173 | KMS key for Lambda environment variables | The environment holds only names and versions, no secrets | A secret is ever needed (use a secret store, not env) |
| CKV_AWS_338 | 1-year log retention | 14 days by design, to keep cost low (§3.3) | Audit needs longer retention |
| CKV_AWS_28 | DynamoDB point-in-time recovery | Off in dev; PITR is cost-reviewed later (§12.3) | Data worth restoring exists |
| CKV_AWS_117 | Lambda inside a VPC | Blueprint §3.2: no VPC/NAT for Lambdas that only call public AWS endpoints | The Lambda must reach private resources |
| CKV_AWS_116 | Lambda dead-letter queue | The API is invoked synchronously; a DLQ applies only to async invokes | An async consumer is added (Phase 5 ingest has its own) |
| CKV_AWS_115 | Lambda reserved concurrency | New accounts may have a 10-concurrency limit; API Gateway throttling caps load | The account limit is raised |
| CKV_AWS_50 | X-Ray tracing | Optional after MVP (§3.3) | Phase 8 observability |
| CKV_AWS_272 | Lambda code signing | Deferred; deploys are owner-run from reviewed commits | A CI deploy pipeline exists |
| CKV_AWS_309 | Authorization on every API route | `GET /v1/health` is public by design (§4.2); every other route is JWT and tested | Never for health; all new routes must be JWT |
| CKV_AWS_144 | S3 cross-region replication | Single region by design (§0) | Multi-region DR (roadmap) |
| CKV_AWS_18 | S3 access logging | A small private state bucket; CloudTrail covers management events | Shared access to the bucket |
| CKV2_AWS_62 | S3 event notifications | Not needed for a state bucket | Never |
