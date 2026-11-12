# Phase 3 cost estimate (planning, not a bill)

Control plane in `ap-southeast-1` at demo traffic: a few hundred API calls a month, three test users, no stored incidents yet. **These are planning assumptions.** Check current prices on the AWS pricing pages and the AWS Pricing Calculator before applying, and record the actual cost after deploy (§11.2).

| Service | What we run | Expected monthly cost at idle / demo use |
|---|---|---|
| S3 (state) | One small versioned bucket, a few KB of state | well under $0.01 |
| DynamoDB | Five on-demand tables, empty | $0 (pay per request; storage negligible) |
| Lambda | One 128 MB arm64 function, a few hundred invokes | $0 within the free tier |
| API Gateway HTTP API | A few hundred requests | under $0.01 |
| Cognito (Lite) | 3 test users | $0 within the free MAU allowance (check the current terms) |
| CloudWatch Logs | Two log groups, 14-day retention, KBs of logs | $0 within the free tier |
| AWS Budgets | none (existing account budgets cover it) | $0 |
| IAM, OIDC provider | Roles and one provider | $0 |
| **Total** | | **about $0–$0.10** |

Not used, by design: NAT gateway, load balancer, RDS, OpenSearch, ECS/EKS, KMS customer keys, VPC endpoints, X-Ray.

## Watch for

- The account's existing budgets (a monthly cost budget and a zero-spend budget) alert on any spend. The account is shared, so filter Cost Explorer by the tag `opsentra:project=opsentra` to see Opsentra's share. Activate that tag as a cost allocation tag in Billing to make the filter work.
- After each apply and live test, check Billing → Bills and Cost Explorer (filtered by the tag `opsentra:project=opsentra`) and record the result here.

## Actuals

| Date | Event | Cost observed | Notes |
|---|---|---|---|
| 2026-11-12 | Bootstrap + control plane deployed; 6 live test calls | Not visible yet (billing lags about 24 h) | Check Cost Explorer by tag `opsentra:project=opsentra` |
