# Cost log

Opsentra runs on a **shared** AWS account in `ap-southeast-1`. This log records **observed** costs only. The planning estimates are in [`phase-3-estimate.md`](phase-3-estimate.md) and [`phase-4-estimate.md`](phase-4-estimate.md). Credit balances are never recorded here.

## Observed

| Period | Opsentra usage (US$) | How measured | Notes |
|---|---|---|---|
| 2026-11-01 to 11-13 (the whole build and all live gates, Phases 3–9) | **≈ 0.035** | Cost Explorer, usage only (credits excluded), by service | EC2 0.0178, VPC public IPv4 0.0091, S3 0.0030, EBS 0.0027, DynamoDB 0.0018, API Gateway 0.0006. Lambda, CloudWatch, Cognito, SNS and SQS were within free tiers. Cost Explorer reads cost 0.04 extra ($0.01 per call). Other projects on the account (Amplify, AppSync) are excluded. Billing data lags about a day |

The `opsentra:project` cost-allocation tag was **inactive** when measured, so the figures are per service. They are an upper bound for Opsentra on those services. **To do (owner):** activate the tag in Billing → Cost allocation tags, so later checks can filter by project.

## What drives cost

| Item | Rate (ap-southeast-1, list) | Exposure |
|---|---|---|
| Lab EC2 t4g.nano | ≈ $0.0053 per hour | Only while the lab exists; it self-terminates at `lab_expires_at` |
| Lab public IPv4 | $0.005 per hour | Same |
| Lab EBS gp3 8 GB | ≈ $0.001 per hour | Deleted on terminate |
| Lab alarm | $0.10 per alarm-month, prorated | Destroyed with the lab |
| Lambda, API Gateway, DynamoDB on-demand | Per request | Low traffic; mostly free tier |
| Reconciler (every 2 minutes) | about 21,600 invocations per month | Free tier |
| CloudWatch dashboard | First 3 per account free | 1 dashboard |
| Cost Explorer API | $0.01 per request | Used only for cost checks |

**Lab rule of thumb:** about **US$0.01–0.02 per hour** while deployed. A typical demo or gate run lasts 30–90 minutes.

## Guardrails (CLAUDE.md, blueprint §11)

No NAT gateways, load balancers, RDS, OpenSearch, EKS/ECS or always-on compute. The lab expires itself, and the probe schedule ends with it. Logs keep 14 days. Every lab run ends with `terraform destroy` and `scripts/gate/verify_teardown.py`.

## How to check

```bash
# Usage cost by service for a period (≈ $0.01 per call; credits excluded, none printed)
aws ce get-cost-and-usage --time-period Start=2026-11-01,End=2026-12-01 --granularity MONTHLY \
  --metrics UnblendedCost --filter '{"Dimensions":{"Key":"RECORD_TYPE","Values":["Usage"]}}' \
  --group-by Type=DIMENSION,Key=SERVICE
```

Once the tag is active, add `Type=TAG,Key=opsentra:project` grouping, or a tag filter.
