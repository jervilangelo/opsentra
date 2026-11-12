# -------------------------------------------------------- health probe ---

locals {
  probe_name     = "${local.name}-health-check"
  schedule_name  = "${local.name}-health-check"
  schedule_group = "default"
  schedule_arn   = "arn:aws:scheduler:${var.region}:${var.account_id}:schedule/${local.schedule_group}/${local.schedule_name}"
  namespace      = "Opsentra/Lab"
}

data "archive_file" "probe" {
  type        = "zip"
  source_dir  = "${path.root}/../../../services/health-check/src"
  output_path = "${path.root}/.build/${local.probe_name}.zip"
  excludes    = ["**/__pycache__/**", "**/*.pyc"]
}

resource "aws_cloudwatch_log_group" "probe" {
  name              = "/aws/lambda/${local.probe_name}"
  retention_in_days = var.log_retention_days
}

locals {
  lambda_trust_policy = {
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
      Condition = { StringEquals = { "aws:SourceAccount" = var.account_id } }
    }]
  }

  probe_policy = {
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "OwnLogs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.probe.arn}:*"
      },
      {
        # PutMetricData has no resource-level permissions; the namespace condition limits it.
        Sid       = "OneMetricNamespace"
        Effect    = "Allow"
        Action    = ["cloudwatch:PutMetricData"]
        Resource  = "*"
        Condition = { StringEquals = { "cloudwatch:namespace" = local.namespace } }
      },
      {
        # DescribeInstances has no resource-level permissions.
        Sid      = "DescribeInstances"
        Effect   = "Allow"
        Action   = ["ec2:DescribeInstances"]
        Resource = "*"
      },
      {
        Sid       = "UpdateOnlyThisRegistryItem"
        Effect    = "Allow"
        Action    = ["dynamodb:UpdateItem"]
        Resource  = local.resources_table_arn
        Condition = { "ForAllValues:StringEquals" = { "dynamodb:LeadingKeys" = [aws_instance.web.id] } }
      },
      {
        Sid      = "DisableOwnSchedule"
        Effect   = "Allow"
        Action   = ["scheduler:GetSchedule", "scheduler:UpdateSchedule"]
        Resource = local.schedule_arn
      },
      {
        Sid       = "PassSchedulerRoleOnUpdate"
        Effect    = "Allow"
        Action    = ["iam:PassRole"]
        Resource  = aws_iam_role.scheduler.arn
        Condition = { StringEquals = { "iam:PassedToService" = "scheduler.amazonaws.com" } }
      },
    ]
  }
}

resource "aws_iam_role" "probe" {
  name               = "${local.probe_name}-role"
  assume_role_policy = jsonencode(local.lambda_trust_policy)
}

resource "aws_iam_role_policy" "probe" {
  name   = "probe"
  role   = aws_iam_role.probe.id
  policy = jsonencode(local.probe_policy)
}

resource "aws_lambda_function" "probe" {
  function_name    = local.probe_name
  role             = aws_iam_role.probe.arn
  runtime          = "python3.12"
  architectures    = ["arm64"]
  handler          = "opsentra_health.handler.lambda_handler"
  filename         = data.archive_file.probe.output_path
  source_code_hash = data.archive_file.probe.output_base64sha256
  memory_size      = 256 # boto3 cold start; still within the free tier at 1 call/min
  timeout          = 10

  environment {
    variables = {
      TARGET_URL       = "http://${aws_instance.web.public_ip}/health"
      MARKER           = local.marker
      INSTANCE_ID      = aws_instance.web.id
      RESOURCES_TABLE  = local.resources_table_name
      METRIC_NAMESPACE = local.namespace
      SCENARIO         = "nginx"
      SCHEDULE_NAME    = local.schedule_name
      SCHEDULE_GROUP   = local.schedule_group
      EXPIRES_AT       = local.expires_at
    }
  }

  logging_config {
    log_format = "Text"
    log_group  = aws_cloudwatch_log_group.probe.name
  }

  depends_on = [aws_iam_role_policy.probe]
}

# EventBridge Scheduler invokes the probe; destroying the lab removes it.
resource "aws_iam_role" "scheduler" {
  name = "${local.name}-scheduler"
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
  name = "invoke-probe"
  role = aws_iam_role.scheduler.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["lambda:InvokeFunction"]
      Resource = aws_lambda_function.probe.arn
    }]
  })
}

resource "aws_scheduler_schedule" "probe" {
  #checkov:skip=CKV_AWS_297:The schedule holds no secrets; a customer-managed key costs more than the lab.
  name        = local.schedule_name
  group_name  = local.schedule_group
  description = "Opsentra lab health probe"
  state       = "ENABLED"

  schedule_expression = "rate(${var.probe_rate_minutes} minute${var.probe_rate_minutes == 1 ? "" : "s"})"
  end_date            = local.expires_at

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.probe.arn
    role_arn = aws_iam_role.scheduler.arn
    retry_policy {
      maximum_retry_attempts = 0
    }
  }

  lifecycle {
    ignore_changes = [state, description] # the probe may disable itself
  }
}

# ----------------------------------------------------------------- alarm ---

resource "aws_cloudwatch_metric_alarm" "nginx" {
  alarm_name          = "${local.name}-nginx-availability"
  alarm_description   = "Nginx health page failed 3 consecutive one-minute probes."
  namespace           = local.namespace
  metric_name         = "NginxAvailability"
  dimensions          = { Scenario = "nginx" }
  statistic           = "Minimum"
  period              = 60
  evaluation_periods  = 3
  datapoints_to_alarm = 3
  comparison_operator = "LessThanThreshold"
  threshold           = 1
  treat_missing_data  = "missing" # no probe data is unknown, never a fake OK
}

# --------------------------------------------- event ingestion (basic) ---
# Alarm state changes for lab alarms land in a log group. Phase 5 adds the
# incident-ingest Lambda as the target.

resource "aws_cloudwatch_log_group" "alarm_events" {
  name              = "/aws/events/${local.name}-alarms"
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_event_rule" "alarm_state" {
  name        = "${local.name}-alarm-state"
  description = "CloudWatch alarm state changes for Opsentra lab alarms"
  event_pattern = jsonencode({
    source        = ["aws.cloudwatch"]
    "detail-type" = ["CloudWatch Alarm State Change"]
    detail        = { alarmName = [{ prefix = "${local.name}-" }] }
  })
}

resource "aws_cloudwatch_event_target" "alarm_logs" {
  rule = aws_cloudwatch_event_rule.alarm_state.name
  arn  = aws_cloudwatch_log_group.alarm_events.arn
}

resource "aws_cloudwatch_log_resource_policy" "events_to_logs" {
  policy_name = "${local.name}-events-to-logs"
  policy_document = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = ["events.amazonaws.com", "delivery.logs.amazonaws.com"] }
      Action    = ["logs:CreateLogStream", "logs:PutLogEvents"]
      Resource  = "${aws_cloudwatch_log_group.alarm_events.arn}:*"
    }]
  })
}
