# Incident ingest, reconciler, alerting (ADR-016), the remediation
# coordinator (ADR-017) and the Simulation Lab controller (ADR-018;
# blueprint §3.1, §4.1, §4.4).
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
  description = "incidents, audit, correlations, resources, remediations, lab_runs -> { name, arn }"
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
  default = 2
}

variable "runbook_document_prefix" {
  description = "The only SSM documents the coordinator may run (owned by the lab root)."
  type        = string
  default     = "Opsentra-Lab-"
}

variable "log_retention_days" {
  type    = number
  default = 14
}

locals {
  ingest_name      = "${var.name_prefix}-incident-ingest"
  reconciler_name  = "${var.name_prefix}-incident-reconciler"
  coordinator_name = "${var.name_prefix}-remediation-coordinator"
  lab_name         = "${var.name_prefix}-lab-controller"
  table_arns       = [for t in values(var.tables) : t.arn]
  env = {
    INCIDENTS_TABLE    = var.tables["incidents"].name
    AUDIT_TABLE        = var.tables["audit"].name
    CORRELATIONS_TABLE = var.tables["correlations"].name
    RESOURCES_TABLE    = var.tables["resources"].name
    REMEDIATIONS_TABLE = var.tables["remediations"].name
    LAB_RUNS_TABLE     = var.tables["lab_runs"].name
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

resource "aws_sqs_queue" "coordinator_dlq" {
  name                      = "${local.coordinator_name}-dlq"
  message_retention_seconds = 14 * 24 * 3600
  sqs_managed_sse_enabled   = true
  tags                      = { "opsentra:component" = "remediation" }
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
      Resource = [var.tables["incidents"].arn, var.tables["audit"].arn, var.tables["correlations"].arn, var.tables["remediations"].arn, var.tables["lab_runs"].arn]
    },
    {
      Sid      = "ReadRegistryAndCorrelations"
      Effect   = "Allow"
      Action   = ["dynamodb:GetItem", "dynamodb:Scan"]
      Resource = [var.tables["resources"].arn, var.tables["correlations"].arn, var.tables["remediations"].arn, var.tables["lab_runs"].arn]
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

  # Runs only Opsentra lab documents, only on instances tagged opsentra:lab=true.
  # The request, registry and document hash are checked again in code (ADR-017).
  runbook_statements = [
    {
      Sid      = "RunLabDocumentsOnly"
      Effect   = "Allow"
      Action   = ["ssm:SendCommand"]
      Resource = "arn:aws:ssm:${var.region}:${var.account_id}:document/${var.runbook_document_prefix}*"
    },
    {
      Sid       = "OnLabInstancesOnly"
      Effect    = "Allow"
      Action    = ["ssm:SendCommand"]
      Resource  = "arn:aws:ec2:${var.region}:${var.account_id}:instance/*"
      Condition = { StringEquals = { "ssm:resourceTag/opsentra:lab" = "true" } }
    },
    {
      Sid      = "ReadCommandStatusAndTargets"
      Effect   = "Allow"
      Action   = ["ssm:GetCommandInvocation", "ec2:DescribeInstances"] # no resource-level support
      Resource = "*"
    },
  ]

  # The lab controller: exactly the two lab documents (inject, reset), on lab-tagged
  # instances only. Readiness checks need the describe calls, which have no
  # resource-level permissions. It cannot run any other document.
  lab_documents = ["${var.runbook_document_prefix}StopNginx", "${var.runbook_document_prefix}RestartNginx"]
  lab_controller_policy = {
    Version = "2012-10-17"
    # DynamoDB only from the shared statements: no SNS publish, no KMS.
    Statement = concat([for s in local.data_statements : s if contains(["IncidentData", "ReadRegistryAndCorrelations"], s.Sid)], [
      {
        Sid      = "TwoLabDocumentsOnly"
        Effect   = "Allow"
        Action   = ["ssm:SendCommand"]
        Resource = [for d in local.lab_documents : "arn:aws:ssm:${var.region}:${var.account_id}:document/${d}"]
      },
      {
        Sid       = "OnLabInstancesOnly"
        Effect    = "Allow"
        Action    = ["ssm:SendCommand"]
        Resource  = "arn:aws:ec2:${var.region}:${var.account_id}:instance/*"
        Condition = { StringEquals = { "ssm:resourceTag/opsentra:lab" = "true" } }
      },
      {
        Sid      = "ReadinessChecks"
        Effect   = "Allow"
        Action   = ["ssm:DescribeInstanceInformation", "ssm:GetCommandInvocation", "ec2:DescribeInstances"] # no resource-level support
        Resource = "*"
      },
      {
        Sid      = "OwnLogs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.lab.arn}:*"
      },
    ])
  }

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
    Statement = concat(local.data_statements, local.runbook_statements, [
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

  coordinator_policy = {
    Version = "2012-10-17"
    Statement = concat(local.data_statements, local.runbook_statements, [
      {
        Sid      = "OwnLogs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.coordinator.arn}:*"
      },
      {
        Sid      = "DeadLetter"
        Effect   = "Allow"
        Action   = ["sqs:SendMessage"]
        Resource = aws_sqs_queue.coordinator_dlq.arn
      },
    ])
  }
}

resource "aws_cloudwatch_log_group" "ingest" {
  name              = "/aws/lambda/${local.ingest_name}"
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_log_group" "coordinator" {
  name              = "/aws/lambda/${local.coordinator_name}"
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_log_group" "lab" {
  name              = "/aws/lambda/${local.lab_name}"
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

resource "aws_iam_role" "coordinator" {
  name               = "${local.coordinator_name}-role"
  assume_role_policy = jsonencode(local.lambda_trust)
}

resource "aws_iam_role_policy" "coordinator" {
  name   = "coordinator"
  role   = aws_iam_role.coordinator.id
  policy = jsonencode(local.coordinator_policy)
}

resource "aws_iam_role" "lab" {
  name               = "${local.lab_name}-role"
  assume_role_policy = jsonencode(local.lambda_trust)
}

resource "aws_iam_role_policy" "lab" {
  name   = "lab-controller"
  role   = aws_iam_role.lab.id
  policy = jsonencode(local.lab_controller_policy)
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

resource "aws_lambda_function" "coordinator" {
  #checkov:skip=CKV_AWS_115:Account concurrency limit is 10; one invocation per approval or SSM status change.
  function_name    = local.coordinator_name
  role             = aws_iam_role.coordinator.arn
  runtime          = "python3.12"
  architectures    = ["arm64"]
  handler          = "opsentra_incidents.coordinator.lambda_handler"
  filename         = data.archive_file.code.output_path
  source_code_hash = data.archive_file.code.output_base64sha256
  memory_size      = 256
  timeout          = 30

  environment { variables = local.env }

  dead_letter_config {
    target_arn = aws_sqs_queue.coordinator_dlq.arn
  }

  logging_config {
    log_format = "Text"
    log_group  = aws_cloudwatch_log_group.coordinator.name
  }

  tags       = { "opsentra:component" = "remediation" }
  depends_on = [aws_iam_role_policy.coordinator]
}

# Retries are safe: dispatch takes a conditional lock and never resends.
resource "aws_lambda_function_event_invoke_config" "coordinator" {
  function_name                = aws_lambda_function.coordinator.function_name
  maximum_retry_attempts       = 2
  maximum_event_age_in_seconds = 900
}

# Invoked synchronously by the API Lambda only; no event source, no retries.
resource "aws_lambda_function" "lab" {
  #checkov:skip=CKV_AWS_115:Account concurrency limit is 10; one call per admin lab action.
  #checkov:skip=CKV_AWS_116:Synchronous call from the API; the caller sees any failure.
  function_name    = local.lab_name
  role             = aws_iam_role.lab.arn
  runtime          = "python3.12"
  architectures    = ["arm64"]
  handler          = "opsentra_incidents.lab_controller.lambda_handler"
  filename         = data.archive_file.code.output_path
  source_code_hash = data.archive_file.code.output_base64sha256
  memory_size      = 256
  timeout          = 8 # inside the API's 10 s budget

  environment { variables = local.env }

  logging_config {
    log_format = "Text"
    log_group  = aws_cloudwatch_log_group.lab.name
  }

  tags       = { "opsentra:component" = "lab" }
  depends_on = [aws_iam_role_policy.lab]
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
  timeout          = 60

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
output "coordinator_function_arn" { value = aws_lambda_function.coordinator.arn }
output "coordinator_function_name" { value = aws_lambda_function.coordinator.function_name }
output "coordinator_policy" { value = local.coordinator_policy }
output "lab_controller_function_arn" { value = aws_lambda_function.lab.arn }
output "lab_controller_function_name" { value = aws_lambda_function.lab.function_name }
output "lab_controller_policy" { value = local.lab_controller_policy }
output "coordinator_has_dlq" { value = aws_lambda_function.coordinator.dead_letter_config[0].target_arn == aws_sqs_queue.coordinator_dlq.arn }
output "has_dlq" { value = aws_lambda_function.ingest.dead_letter_config[0].target_arn == aws_sqs_queue.ingest_dlq.arn }
