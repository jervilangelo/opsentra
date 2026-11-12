# Phase 4 cost estimate (lab)

Prices from the AWS Pricing API for `ap-southeast-1`, read on 2026-11-12. These are on-demand list prices; credits and free tiers may lower the bill.

| Item | Price | While the lab exists |
|---|---|---|
| EC2 t4g.nano (Linux) | $0.0053 per hour | $0.0053/h |
| Public IPv4 address | $0.005 per hour | $0.005/h |
| EBS gp3, 8 GB | $0.096 per GB-month | about $0.001/h |
| CloudWatch alarms (2) | $0.10 per alarm-month | prorated, about $0.0003/h |
| Custom metric (1) | per metric-month, prorated hourly | under $0.001/h |
| Lambda probe (60 calls/hour), Scheduler, EventBridge, Logs | free tier at this volume | about $0 |
| **Total** | | **about $0.011 per hour (about $0.27 per day)** |

- **A typical gate test** (about 3 hours) costs about **$0.04**.
- **A forgotten lab** would cost about $8 a month, but it cannot run that long. The instance terminates itself at `lab_expires_at` (at most 12 hours away), and the probe disables its own schedule.

## Actuals

| Date | Event | Cost observed | Notes |
|---|---|---|---|
| 2026-11-12 | Lab up about 06:00–06:50 UTC (one instance replacement), gate test, destroyed | Estimate about $0.01; billing lags about 24 h | Check Cost Explorer by tag `opsentra:project=opsentra` |
