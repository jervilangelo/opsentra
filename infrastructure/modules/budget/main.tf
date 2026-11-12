# Monthly cost budget with early email alerts (blueprint §11.1). Budgets are
# delayed and are not a spending cap. Credits are excluded, so alerts reflect
# real usage even while promotional credits cover the bill.

terraform {
  required_providers {
    aws = { source = "hashicorp/aws" }
  }
}

variable "name_prefix" {
  type = string
}

variable "monthly_limit_usd" {
  type    = number
  default = 5
}

variable "alert_email" {
  description = "Where budget alerts go. Set in terraform.tfvars (gitignored)."
  type        = string
  sensitive   = true
}

locals {
  actual_thresholds = [20, 60, 100]
}

resource "aws_budgets_budget" "monthly" {
  name         = "${var.name_prefix}-monthly"
  budget_type  = "COST"
  limit_amount = format("%.2f", var.monthly_limit_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  cost_types {
    include_credit = false
    include_refund = false
  }

  dynamic "notification" {
    for_each = local.actual_thresholds
    content {
      comparison_operator        = "GREATER_THAN"
      threshold                  = notification.value
      threshold_type             = "PERCENTAGE"
      notification_type          = "ACTUAL"
      subscriber_email_addresses = [var.alert_email]
    }
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.alert_email]
  }

  tags = { "opsentra:component" = "cost" }
}

output "budget_name" {
  value = aws_budgets_budget.monthly.name
}

output "includes_credits" {
  value = aws_budgets_budget.monthly.cost_types[0].include_credit
}
