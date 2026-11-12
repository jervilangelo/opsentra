# Incident ingest, reconciler and alerting (blueprint §3.1, §4.1, §4.4; ADR-016).
# Least privilege: no DeleteItem anywhere (the audit trail is append-only).

terraform {
  required_providers {
    aws     = { source = "hashicorp/aws" }
    archive = { source = "hashicorp/archive" }
  }
}

variable "name_prefix" { type = string }
variable "region" { type = string }
variable "account_id" { type = string }
variable "source_dir" { type = string }
variable "build_dir" { type = string }

variable "tables" {
  description = "incidents, audit, correlations, resources -> { name, arn }"
  type        = map(object({ name = string, arn = string }))
}

variable "alert_email" {
  description = "Incident alert subscriber. Empty: topic only. terraform.tfvars only."
  type        = string
  default     = ""
  sensitive   = true
}

variable "alarm_name_prefix" {
  description = "The reconciler may describe only alarms with this prefix."
  type        = string
  default     = "opsentra-lab-"
}

variable "reconcile_rate_minutes" {
  type    = number
  default = 5
}

variable "log_retention_days" {
  type    = number
  default = 14
}

locals {
  ingest_name     = "${var.name_prefix}-incident-ingest"
  reconciler_name = "${var.name_prefix}-incident-reconciler"
  table_arns      = [for t in values(var.tables) : t.arn]
  env = {
    INCIDENTS_TABLE    = var.tables["incidents"].name
    AUDIT_TABLE        = var.tables["audit"].name
    CORRELATIONS_TABLE = var.tables["correlations"].name
    RESOURCES_TABLE    = var.tables["resources"].name
    ACCOUNT_ID         = var.account_id
    ALERT_TOPIC_ARN    = aws_sns_topic.alerts.arn
  }
}

data "archive_file" "code" {
  type        = "zip"
  source_dir  = var.source_dir
  output_path = "${var.build_dir}/${var.name_prefix}-incidents.zip"
  excludes    = ["**/__pycache__/**", "**/*.pyc"]
}

# ------------------------------------------------------------- alerting ---

resource "aws_sns_topic" "alerts" {
  name              = "${var.name_prefix}-incidents"
  kms_master_key_id = "alias/aws/sns" # AWS-managed key: encrypted, no key cost
  tags              = { "opsentra:component" = "alerting" }
}

resource "aws_sns_topic_subscription" "email" {
  count     = var.alert_email == "" ? 0 : 1
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

resource "aws_sqs_queue" "ingest_dlq" {
  name                      = "${local.ingest_name}-dlq"
  message_retention_seconds = 14 * 24 * 3600
  sqs_managed_sse_enabled   = true
  tags                      = { "opsentra:component" = "incidents" }
}

# ---------------------------------------------------------------- roles ---

locals {
  lambda_trust = {
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
      Condition = { StringEquals = { "aws:SourceAccount" = var.account_id } }
    }]
  }

  data_statements = [
    {
      Sid      = "IncidentData"
      Effect   = "Allow"
      Action   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:ConditionCheckItem", "dynamodb:Query"]
      Resource = [var.tables["incidents"].arn, var.tables["audit"].arn, var.tables["correlations"].arn]
    },
    {
      Sid      = "ReadRegistryAndCorrelations"
      Effect   = "Allow"
      Action   = ["dynamodb:GetItem", "dynamodb:Scan"]
      Resource = [var.tables["resources"].arn, var.tables["correlations"].arn]
    },
    {
      Sid      = "PublishAlerts"
      Effect   = "Allow"
      Action   = ["sns:Publish"]
      Resource = aws_sns_topic.alerts.arn
    },
    {
      Sid       = "UseAwsManagedSnsKey"
      Effect    = "Allow"
      Action    = ["kms:GenerateDataKey", "kms:Decrypt"]
      Resource  = "*"
      Condition = { StringEquals = { "kms:ViaService" = "sns.${var.region}.amazonaws.com" } }
    },
  ]

  ingest_policy = {
    Version = "2012-10-17"
    Statement = concat(local.data_statements, [
      {
        Sid      = "OwnLogs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.ingest.arn}:*"
      },
      {
        Sid      = "DeadLetter"
        Effect   = "Allow"
        Action   = ["sqs:SendMessage"]
        Resource = aws_sqs_queue.ingest_dlq.arn
      },
    ])
  }

  reconciler_policy = {
    Version = "2012-10-17"
    Statement = concat(local.data_statements, [
      {
        Sid      = "OwnLogs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.reconciler.arn}:*"
      },
      {
        Sid      = "DescribeLabAlarms"
        Effect   = "Allow"
        Action   = ["cloudwatch:DescribeAlarms"]
        Resource = "arn:aws:cloudwatch:${var.region}:${var.account_id}:alarm:${var.alarm_name_prefix}*"
      },
    ])
  }
}

resource "aws_cloudwatch_log_group" "ingest" {
  name              = "/aws/lambda/${local.ingest_name}"
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_log_group" "reconciler" {
  name              = "/aws/lambda/${local.reconciler_name}"
  retention_in_days = var.log_retention_days
}

resource "aws_iam_role" "ingest" {
  name               = "${local.ingest_name}-role"
  assume_role_policy = jsonencode(local.lambda_trust)
}

resource "aws_iam_role_policy" "ingest" {
  name   = "ingest"
  role   = aws_iam_role.ingest.id
  policy = jsonencode(local.ingest_policy)
}

resource "aws_iam_role" "reconciler" {
  name               = "${local.reconciler_name}-role"
  assume_role_policy = jsonencode(local.lambda_trust)
}

resource "aws_iam_role_policy" "reconciler" {
  name   = "reconciler"
  role   = aws_iam_role.reconciler.id
  policy = jsonencode(local.reconciler_policy)
}

# -------------------------------------------------------------- lambdas ---

resource "aws_lambda_function" "ingest" {
  #checkov:skip=CKV_AWS_115:Account concurrency limit is 10; EventBridge volume is a few events per test.
  function_name    = local.ingest_name
  role             = aws_iam_role.ingest.arn
  runtime          = "python3.12"
  architectures    = ["arm64"]
  handler          = "opsentra_incidents.ingest.lambda_handler"
  filename         = data.archive_file.code.output_path
  source_code_hash = data.archive_file.code.output_base64sha256
  memory_size      = 256
  timeout          = 15

  environment { variables = local.env }

  dead_letter_config {
    target_arn = aws_sqs_queue.ingest_dlq.arn
  }

  logging_config {
    log_format = "Text"
    log_group  = aws_cloudwatch_log_group.ingest.name
  }

  tags       = { "opsentra:component" = "incidents" }
  depends_on = [aws_iam_role_policy.ingest]
}

resource "aws_lambda_function_event_invoke_config" "ingest" {
  function_name                = aws_lambda_function.ingest.function_name
  maximum_retry_attempts       = 2
  maximum_event_age_in_seconds = 3600
}

resource "aws_lambda_function" "reconciler" {
  #checkov:skip=CKV_AWS_115:Account concurrency limit is 10; one scheduled run every 5 minutes.
  #checkov:skip=CKV_AWS_116:Scheduled reconciler: a failed run is simply repeated by the next one.
  function_name    = local.reconciler_name
  role             = aws_iam_role.reconciler.arn
  runtime          = "python3.12"
  architectures    = ["arm64"]
  handler          = "opsentra_incidents.reconciler.lambda_handler"
  filename         = data.archive_file.code.output_path
  source_code_hash = data.archive_file.code.output_base64sha256
  memory_size      = 256
  timeout          = 30

  environment { variables = local.env }

  logging_config {
    log_format = "Text"
    log_group  = aws_cloudwatch_log_group.reconciler.name
  }

  tags       = { "opsentra:component" = "incidents" }
  depends_on = [aws_iam_role_policy.reconciler]
}

resource "aws_iam_role" "scheduler" {
  name = "${local.reconciler_name}-scheduler"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "scheduler.amazonaws.com" }
      Action    = "sts:AssumeRole"
      Condition = { StringEquals = { "aws:SourceAccount" = var.account_id } }
    }]
  })
}

resource "aws_iam_role_policy" "scheduler" {
  name = "invoke-reconciler"
  role = aws_iam_role.scheduler.id
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = ["lambda:InvokeFunction"], Resource = aws_lambda_function.reconciler.arn }]
  })
}

resource "aws_scheduler_schedule" "reconciler" {
  #checkov:skip=CKV_AWS_297:The schedule holds no secrets; a customer-managed key costs more than it protects.
  name                = local.reconciler_name
  description         = "Opsentra incident reconciler"
  schedule_expression = "rate(${var.reconcile_rate_minutes} minutes)"

  flexible_time_window { mode = "OFF" }

  target {
    arn      = aws_lambda_function.reconciler.arn
    role_arn = aws_iam_role.scheduler.arn
    retry_policy { maximum_retry_attempts = 0 }
  }
}

# -------------------------------------------------------------- outputs ---

output "ingest_function_arn" { value = aws_lambda_function.ingest.arn }
output "ingest_function_name" { value = aws_lambda_function.ingest.function_name }
output "alert_topic_name" { value = aws_sns_topic.alerts.name }
output "ingest_policy" { value = local.ingest_policy }
output "reconciler_policy" { value = local.reconciler_policy }
output "reconcile_schedule" { value = aws_scheduler_schedule.reconciler.schedule_expression }
output "has_dlq" { value = aws_lambda_function.ingest.dead_letter_config[0].target_arn == aws_sqs_queue.ingest_dlq.arn }
