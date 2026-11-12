# ----------------------------------- minimal Lambda regression resource ---
# Registered for Scenario B; not exercised until then.

data "archive_file" "regression" {
  type        = "zip"
  output_path = "${path.root}/.build/${local.name}-regression.zip"
  source {
    filename = "app.py"
    content  = <<-PY
      def handler(event, context):
          return {"statusCode": 200, "body": "opsentra-lab regression ok"}
    PY
  }
}

resource "aws_iam_role" "regression" {
  name               = "${local.name}-regression-role"
  assume_role_policy = jsonencode(local.lambda_trust_policy)
}

resource "aws_cloudwatch_log_group" "regression" {
  name              = "/aws/lambda/${local.name}-regression"
  retention_in_days = var.log_retention_days
}

resource "aws_iam_role_policy" "regression" {
  name = "logs"
  role = aws_iam_role.regression.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
      Resource = "${aws_cloudwatch_log_group.regression.arn}:*"
    }]
  })
}

resource "aws_lambda_function" "regression" {
  function_name    = "${local.name}-regression"
  role             = aws_iam_role.regression.arn
  runtime          = "python3.12"
  architectures    = ["arm64"]
  handler          = "app.handler"
  filename         = data.archive_file.regression.output_path
  source_code_hash = data.archive_file.regression.output_base64sha256
  memory_size      = 128
  timeout          = 3
  publish          = true

  logging_config {
    log_format = "Text"
    log_group  = aws_cloudwatch_log_group.regression.name
  }

  depends_on = [aws_iam_role_policy.regression]
}

resource "aws_lambda_alias" "live" {
  name             = "live"
  function_name    = aws_lambda_function.regression.function_name
  function_version = aws_lambda_function.regression.version
}

resource "aws_cloudwatch_metric_alarm" "regression_errors" {
  alarm_name          = "${local.name}-regression-errors"
  alarm_description   = "Lab regression function reported errors in 2 consecutive minutes."
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  dimensions          = { FunctionName = aws_lambda_function.regression.function_name }
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 2
  datapoints_to_alarm = 2
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  treat_missing_data  = "notBreaching" # no invocations means no errors for this function
}

# -------------------------------------------------- resource registry ---
# The server-owned allowlist (§4.3 opsentra-resources). Only these items can
# ever be probed or, from Phase 6, acted on. Destroying the lab removes them.

locals {
  registry = {
    web = {
      resourceId        = { S = aws_instance.web.id }
      type              = { S = "EC2" }
      environment       = { S = "lab" }
      region            = { S = var.region }
      arn               = { S = aws_instance.web.arn }
      allowedRunbookIds = { L = [{ S = "rb-restart-nginx" }] }
      scenario          = { S = "nginx" }
      labExpiresAt      = { S = local.expires_at }
      health            = { S = "UNKNOWN" }
    }
    regression = {
      resourceId        = { S = aws_lambda_function.regression.function_name }
      type              = { S = "LAMBDA" }
      environment       = { S = "lab" }
      region            = { S = var.region }
      arn               = { S = aws_lambda_alias.live.arn }
      allowedRunbookIds = { L = [{ S = "rb-lambda-alias-rollback" }] }
      scenario          = { S = "lambda-regression" }
      labExpiresAt      = { S = local.expires_at }
      health            = { S = "UNKNOWN" }
    }
  }
}

resource "aws_dynamodb_table_item" "registry" {
  for_each   = local.registry
  table_name = local.resources_table_name
  hash_key   = "resourceId"
  item       = jsonencode(each.value)

  lifecycle {
    ignore_changes = [item] # the probe updates health fields in place
    # A new instance means a new resource ID: re-register instead of keeping
    # a stale allowlist entry (caught on the first deploy's re-plan).
    replace_triggered_by = [aws_instance.web.id]
  }
}
