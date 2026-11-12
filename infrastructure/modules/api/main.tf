# HTTP API + Python Lambda (blueprint §3.3, §4.2). /v1/health is public;
# every other route requires a Cognito access token checked by the JWT
# authorizer. The Lambda role can write its own logs and nothing else (ADR-014).

terraform {
  required_providers {
    aws     = { source = "hashicorp/aws" }
    archive = { source = "hashicorp/archive" }
  }
}

variable "name_prefix" {
  type = string
}

variable "region" {
  type = string
}

variable "account_id" {
  type = string
}

variable "environment" {
  type = string
}

variable "source_dir" {
  description = "Folder holding the opsentra_api package."
  type        = string
}

variable "extra_source_dirs" {
  description = "More package folders bundled into the zip (the shared incident core)."
  type        = list(string)
  default     = []
}

variable "write_tables" {
  description = "Tables the API may write with conditional updates (never delete): name -> { name, arn }."
  type        = map(object({ name = string, arn = string }))
  default     = {}
}

variable "build_dir" {
  type = string
}

variable "coordinator_function" {
  description = "The remediation coordinator the API may invoke (async) after an approval."
  type        = object({ name = string, arn = string })
  default     = null
}

variable "jwt_issuer" {
  type = string
}

variable "jwt_audience" {
  description = "Cognito app client IDs whose access tokens are accepted."
  type        = list(string)
}

variable "cors_allow_origins" {
  description = "Exact browser origins allowed to call the API. No wildcards."
  type        = list(string)

  validation {
    condition     = alltrue([for o in var.cors_allow_origins : o != "*" && can(regex("^https?://[^/*]+$", o))])
    error_message = "CORS origins must be exact origins (scheme://host[:port]) with no wildcard or path."
  }
}

variable "read_tables" {
  description = "Tables the API may read (never write): logical name -> { name, arn }."
  type        = map(object({ name = string, arn = string }))
  default     = {}
}

variable "log_retention_days" {
  type    = number
  default = 14
}

variable "throttle_burst" {
  type    = number
  default = 10
}

variable "throttle_rate" {
  type    = number
  default = 5
}

variable "app_version" {
  type    = string
  default = "0.6.0"
}

locals {
  function_name = "${var.name_prefix}-api"
  routes = {
    "GET /v1/health"                              = { protected = false }
    "GET /v1/me"                                  = { protected = true }
    "GET /v1/overview"                            = { protected = true }
    "GET /v1/resources"                           = { protected = true }
    "GET /v1/resources/{resourceId}"              = { protected = true }
    "GET /v1/incidents"                           = { protected = true }
    "GET /v1/incidents/{incidentId}"              = { protected = true }
    "GET /v1/incidents/{incidentId}/timeline"     = { protected = true }
    "POST /v1/incidents/{incidentId}/acknowledge" = { protected = true }
    "POST /v1/incidents/{incidentId}/investigate" = { protected = true }
    "POST /v1/incidents/{incidentId}/close"       = { protected = true }
    "GET /v1/audit"                               = { protected = true }

    "POST /v1/incidents/{incidentId}/request-remediation" = { protected = true }
    "POST /v1/remediations/{requestId}/decision"          = { protected = true }
    "GET /v1/remediations"                                = { protected = true }
    "GET /v1/remediations/{requestId}"                    = { protected = true }
    "GET /v1/runbooks"                                    = { protected = true }
  }

  bundle = merge([
    for dir in concat([var.source_dir], var.extra_source_dirs) : {
      for f in fileset(dir, "**/*.py") : f => "${dir}/${f}" if !strcontains(f, "__pycache__")
    }
  ]...)
}

data "archive_file" "api" {
  type        = "zip"
  output_path = "${var.build_dir}/${local.function_name}.zip"

  dynamic "source" {
    for_each = local.bundle
    content {
      filename = source.key
      content  = file(source.value)
    }
  }
}

resource "aws_cloudwatch_log_group" "lambda" {
  name              = "/aws/lambda/${local.function_name}"
  retention_in_days = var.log_retention_days
  tags              = { "opsentra:component" = "api" }
}

resource "aws_cloudwatch_log_group" "access" {
  name              = "/aws/apigateway/${var.name_prefix}-http-api"
  retention_in_days = var.log_retention_days
  tags              = { "opsentra:component" = "api" }
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

  # Least privilege: its own logs, reads on named tables, conditional writes
  # (never deletes) on the incident tables, and invoking only the coordinator.
  lambda_policy = {
    Version = "2012-10-17"
    Statement = concat(
      [{
        Sid      = "OwnLogsOnly"
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.lambda.arn}:*"
      }],
      length(var.read_tables) == 0 ? [] : [{
        Sid      = "ReadTables"
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:Query", "dynamodb:Scan"]
        Resource = flatten([for t in values(var.read_tables) : [t.arn, "${t.arn}/index/*"]])
      }],
      length(var.write_tables) == 0 ? [] : [{
        Sid      = "ConditionalWritesNoDeletes"
        Effect   = "Allow"
        Action   = ["dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:ConditionCheckItem"]
        Resource = [for t in values(var.write_tables) : t.arn]
      }],
      var.coordinator_function == null ? [] : [{
        Sid      = "InvokeCoordinatorOnly"
        Effect   = "Allow"
        Action   = ["lambda:InvokeFunction"]
        Resource = var.coordinator_function.arn
      }],
    )
  }
}

resource "aws_iam_role" "lambda" {
  name               = "${local.function_name}-role"
  assume_role_policy = jsonencode(local.lambda_trust_policy)
  tags               = { "opsentra:component" = "api" }
}

resource "aws_iam_role_policy" "lambda" {
  name   = "logs"
  role   = aws_iam_role.lambda.id
  policy = jsonencode(local.lambda_policy)
}

resource "aws_lambda_function" "api" {
  function_name    = local.function_name
  role             = aws_iam_role.lambda.arn
  runtime          = "python3.12"
  architectures    = ["arm64"]
  handler          = "opsentra_api.handler.lambda_handler"
  filename         = data.archive_file.api.output_path
  source_code_hash = data.archive_file.api.output_base64sha256
  memory_size      = 256 # more CPU: a cold boto3 start at 128 MB exceeded 5 s
  timeout          = 10

  environment {
    variables = {
      OPSENTRA_ENVIRONMENT = var.environment
      OPSENTRA_VERSION     = var.app_version
      LOG_LEVEL            = "INFO"
      RESOURCES_TABLE      = try(var.read_tables["resources"].name, "")
      INCIDENTS_TABLE      = try(var.read_tables["incidents"].name, "")
      AUDIT_TABLE          = try(var.read_tables["audit"].name, "")
      CORRELATIONS_TABLE   = try(var.write_tables["correlations"].name, "")
      REMEDIATIONS_TABLE   = try(var.write_tables["remediations"].name, "")
      COORDINATOR_FUNCTION = try(var.coordinator_function.name, "")
    }
  }

  logging_config {
    log_format = "Text"
    log_group  = aws_cloudwatch_log_group.lambda.name
  }

  tags = { "opsentra:component" = "api" }

  depends_on = [aws_iam_role_policy.lambda]
}

resource "aws_apigatewayv2_api" "http" {
  name          = "${var.name_prefix}-http-api"
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = var.cors_allow_origins
    allow_methods = ["GET", "POST", "OPTIONS"]
    allow_headers = ["authorization", "content-type", "idempotency-key"]
    max_age       = 600
  }

  tags = { "opsentra:component" = "api" }
}

resource "aws_apigatewayv2_authorizer" "jwt" {
  api_id           = aws_apigatewayv2_api.http.id
  name             = "cognito-jwt"
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]

  jwt_configuration {
    issuer   = var.jwt_issuer
    audience = var.jwt_audience
  }
}

resource "aws_apigatewayv2_integration" "lambda" {
  api_id                 = aws_apigatewayv2_api.http.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api.invoke_arn
  payload_format_version = "2.0"
  timeout_milliseconds   = 11000
}

resource "aws_apigatewayv2_route" "this" {
  for_each = local.routes

  api_id             = aws_apigatewayv2_api.http.id
  route_key          = each.key
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = each.value.protected ? "JWT" : "NONE"
  authorizer_id      = each.value.protected ? aws_apigatewayv2_authorizer.jwt.id : null
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.http.id
  name        = "$default"
  auto_deploy = true

  default_route_settings {
    throttling_burst_limit = var.throttle_burst
    throttling_rate_limit  = var.throttle_rate
  }

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.access.arn
    format = jsonencode({
      requestId = "$context.requestId"
      time      = "$context.requestTime"
      method    = "$context.httpMethod"
      route     = "$context.routeKey"
      status    = "$context.status"
      latencyMs = "$context.responseLatency"
      authError = "$context.authorizer.error"
    })
  }

  tags = { "opsentra:component" = "api" }
}

resource "aws_lambda_permission" "apigw" {
  statement_id  = "AllowHttpApiInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http.execution_arn}/*/*"
}

output "api_url" {
  value = aws_apigatewayv2_api.http.api_endpoint
}

output "function_name" {
  value = aws_lambda_function.api.function_name
}

output "lambda_policy" {
  description = "For tests: the Lambda role's inline policy."
  value       = local.lambda_policy
}

output "route_authorization" {
  description = "For tests: authorization type per route."
  value       = { for k, r in aws_apigatewayv2_route.this : k => r.authorization_type }
}

output "throttling" {
  value = {
    burst = aws_apigatewayv2_stage.default.default_route_settings[0].throttling_burst_limit
    rate  = aws_apigatewayv2_stage.default.default_route_settings[0].throttling_rate_limit
  }
}

output "log_retention_days" {
  value = [aws_cloudwatch_log_group.lambda.retention_in_days, aws_cloudwatch_log_group.access.retention_in_days]
}

output "runtime" {
  value = aws_lambda_function.api.runtime
}
