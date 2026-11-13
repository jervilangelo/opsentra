# Operations dashboard (blueprint §7 Phase 8; ADR-019). One CloudWatch
# dashboard: within the free tier of 3 dashboards per account (the account had
# none on 2026-11-13). Metrics only, plus one Logs Insights widget that runs
# when the dashboard is viewed (Logs Insights bills per GB scanned; these log
# groups are small and keep 14 days).

terraform {
  required_providers {
    aws = { source = "hashicorp/aws" }
  }
}

variable "name_prefix" { type = string }
variable "region" { type = string }
variable "api_id" { type = string }

variable "functions" {
  description = "Lambda function names to chart (errors, invocations, duration)."
  type        = list(string)
}

variable "dlq_names" {
  description = "Dead-letter queues; anything waiting there needs a look."
  type        = list(string)
}

variable "log_groups" {
  description = "Log groups searched by the incident-trail widget."
  type        = list(string)
}

variable "probe_namespace" {
  type    = string
  default = "Opsentra/Lab"
}

locals {
  name = "${var.name_prefix}-operations"

  lambda_metric = { for m in ["Errors", "Invocations", "Throttles"] : m => [
    for f in var.functions : ["AWS/Lambda", m, "FunctionName", f]
  ] }

  widgets = [
    {
      type = "text", x = 0, y = 0, width = 24, height = 2
      properties = {
        markdown = "## Opsentra operations (${var.region})\nLive data only. A gap in the probe chart means **no probe ran** (lab not deployed): unknown, not down. Incident trail: filter the log widget by `incidentId`."
      }
    },
    {
      type = "metric", x = 0, y = 2, width = 12, height = 6
      properties = {
        title   = "Nginx availability (lab probe: 1 = healthy, 0 = failed)"
        region  = var.region
        view    = "timeSeries"
        stat    = "Minimum"
        period  = 60
        yAxis   = { left = { min = 0, max = 1 } }
        metrics = [[var.probe_namespace, "NginxAvailability", "Scenario", "nginx"]]
      }
    },
    {
      type = "metric", x = 12, y = 2, width = 12, height = 6
      properties = {
        title   = "API: requests, 4xx, 5xx"
        region  = var.region
        view    = "timeSeries"
        stat    = "Sum"
        period  = 300
        metrics = [for m in ["Count", "4xx", "5xx"] : ["AWS/ApiGateway", m, "ApiId", var.api_id]]
      }
    },
    {
      type = "metric", x = 0, y = 8, width = 8, height = 6
      properties = {
        title   = "Lambda errors", region = var.region, view = "timeSeries", stat = "Sum", period = 300
        metrics = local.lambda_metric["Errors"]
      }
    },
    {
      type = "metric", x = 8, y = 8, width = 8, height = 6
      properties = {
        title   = "Lambda invocations", region = var.region, view = "timeSeries", stat = "Sum", period = 300
        metrics = local.lambda_metric["Invocations"]
      }
    },
    {
      type = "metric", x = 16, y = 8, width = 8, height = 6
      properties = {
        title   = "API latency (p90, ms)", region = var.region, view = "timeSeries", stat = "p90", period = 300
        metrics = [["AWS/ApiGateway", "Latency", "ApiId", var.api_id]]
      }
    },
    {
      type = "metric", x = 0, y = 14, width = 8, height = 6
      properties = {
        title   = "Dead-letter queues (messages waiting)", region = var.region, view = "singleValue", stat = "Maximum", period = 300
        metrics = [for q in var.dlq_names : ["AWS/SQS", "ApproximateNumberOfMessagesVisible", "QueueName", q]]
      }
    },
    {
      type = "metric", x = 8, y = 14, width = 16, height = 6
      properties = {
        title   = "Lambda throttles", region = var.region, view = "timeSeries", stat = "Sum", period = 300
        metrics = local.lambda_metric["Throttles"]
      }
    },
    {
      type = "log", x = 0, y = 20, width = 24, height = 8
      properties = {
        title  = "Incident trail (structured logs with an incidentId)"
        region = var.region
        view   = "table"
        query = join(" | ", [
          "SOURCE ${join(" | SOURCE ", [for g in var.log_groups : "'${g}'"])}",
          "fields @timestamp, service, msg, incidentId, requestId, runId, result, outcome, incidentState",
          "filter ispresent(incidentId)",
          "sort @timestamp desc",
          "limit 100",
        ])
      }
    },
  ]
}

resource "aws_cloudwatch_dashboard" "operations" {
  dashboard_name = local.name
  dashboard_body = jsonencode({ widgets = local.widgets })
}

output "dashboard_name" { value = aws_cloudwatch_dashboard.operations.dashboard_name }
output "dashboard_widget_count" { value = length(local.widgets) }
