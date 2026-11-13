# Security and cost checks with mocked providers: no AWS credentials, nothing
# is created. Run: terraform init -backend=false && terraform test

mock_provider "aws" {
  mock_resource "aws_cognito_user_pool" {
    defaults = {
      id       = "ap-southeast-1_Mock12345"
      arn      = "arn:aws:cognito-idp:ap-southeast-1:111122223333:userpool/ap-southeast-1_Mock12345"
      endpoint = "cognito-idp.ap-southeast-1.amazonaws.com/ap-southeast-1_Mock12345"
    }
  }
  mock_resource "aws_iam_role" {
    defaults = {
      arn = "arn:aws:iam::111122223333:role/mock"
    }
  }
  mock_resource "aws_lambda_function" {
    defaults = {
      arn        = "arn:aws:lambda:ap-southeast-1:111122223333:function:mock"
      invoke_arn = "arn:aws:apigateway:ap-southeast-1:lambda:path/2015-03-31/functions/arn:aws:lambda:ap-southeast-1:111122223333:function:mock/invocations"
    }
  }
  mock_resource "aws_sqs_queue" {
    defaults = { arn = "arn:aws:sqs:ap-southeast-1:111122223333:mock-dlq" }
  }
  mock_resource "aws_sns_topic" {
    defaults = { arn = "arn:aws:sns:ap-southeast-1:111122223333:mock-topic" }
  }
  mock_resource "aws_apigatewayv2_api" {
    defaults = {
      api_endpoint  = "https://mock.execute-api.ap-southeast-1.amazonaws.com"
      execution_arn = "arn:aws:execute-api:ap-southeast-1:111122223333:mock"
    }
  }
  mock_resource "aws_iam_openid_connect_provider" {
    defaults = {
      arn = "arn:aws:iam::111122223333:oidc-provider/token.actions.githubusercontent.com"
    }
  }
  mock_resource "aws_cloudwatch_log_group" {
    defaults = {
      arn = "arn:aws:logs:ap-southeast-1:111122223333:log-group:mock"
    }
  }
}

variables {
  account_id   = "111122223333"
  state_bucket = "opsentra-tfstate-111122223333-ap-southeast-1"
}

run "api_routes_and_throttling" {
  command = apply # mocked: nothing is created

  assert {
    condition     = module.api.route_authorization["GET /v1/me"] == "JWT"
    error_message = "/v1/me must require a Cognito JWT."
  }
  assert {
    condition     = module.api.route_authorization["GET /v1/health"] == "NONE"
    error_message = "/v1/health is the only public route."
  }
  assert {
    condition     = length([for k, v in module.api.route_authorization : k if v == "NONE"]) == 1
    error_message = "No route other than /v1/health may be public."
  }
  assert {
    condition     = length(module.api.route_authorization) == 21 && alltrue([for k, v in module.api.route_authorization : v == "JWT" if startswith(k, "POST ")])
    error_message = "Phase 8 exposes twenty-one routes and every write route needs a JWT."
  }
  assert {
    condition     = !contains(keys(module.api.route_authorization), "$default") && !anytrue([for k in keys(module.api.route_authorization) : startswith(k, "OPTIONS ") || startswith(k, "ANY ")])
    error_message = "No catch-all, OPTIONS or ANY routes: with a JWT they swallow CORS preflight (401) and break the browser (Phase 9 regression)."
  }
  assert {
    condition     = module.api.route_authorization["GET /v1/analytics"] == "JWT"
    error_message = "Analytics needs a Cognito JWT."
  }
  assert {
    condition     = alltrue([for r in ["GET /v1/labs", "POST /v1/labs/{scenarioId}/start", "POST /v1/labs/{scenarioId}/reset"] : module.api.route_authorization[r] == "JWT"])
    error_message = "The Simulation Lab routes need a Cognito JWT."
  }
  assert {
    condition     = module.api.throttling.burst <= 10 && module.api.throttling.rate <= 5
    error_message = "Stage throttling must stay low for a demo account."
  }
  assert {
    condition     = module.api.runtime == "python3.12"
    error_message = "Lambda runtime must match the local test Python (3.12)."
  }
}

run "lambda_role_is_least_privilege" {
  command = apply # mocked: nothing is created

  assert {
    condition = alltrue(flatten([
      for s in module.api.lambda_policy.Statement : [
        for a in s.Action : contains(["logs:CreateLogStream", "logs:PutLogEvents", "dynamodb:GetItem", "dynamodb:Query", "dynamodb:Scan", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:ConditionCheckItem", "lambda:InvokeFunction", "cloudwatch:GetMetricStatistics"], a)
      ]
    ]))
    error_message = "The API Lambda may write its logs, read tables, make conditional writes, invoke the coordinator and lab controller, and read metric statistics; nothing else."
  }
  assert {
    condition = alltrue([
      for s in module.api.lambda_policy.Statement : toset(s.Resource) == toset([module.incidents.coordinator_function_arn, module.incidents.lab_controller_function_arn])
      if contains(s.Action, "lambda:InvokeFunction")
    ])
    error_message = "The API may invoke only the remediation coordinator and the lab controller."
  }
  assert {
    condition = !anytrue(flatten([
      for s in module.api.lambda_policy.Statement : [for a in s.Action : startswith(a, "ssm:") || startswith(a, "ec2:")]
    ]))
    error_message = "The API never calls SSM or EC2 itself; only the coordinator runs runbooks."
  }
  assert {
    condition     = alltrue([for s in module.api.lambda_policy.Statement : s.Action == ["cloudwatch:GetMetricStatistics"] if s.Resource == "*"])
    error_message = "The only wildcard resource on the API role is the read-only GetMetricStatistics (no resource-level support)."
  }
}

run "observability_dashboard" {
  command = apply # mocked: nothing is created

  assert {
    condition     = module.observability.dashboard_name == "opsentra-dev-operations"
    error_message = "One operations dashboard, named after the environment."
  }
  assert {
    condition     = module.observability.dashboard_widget_count <= 10
    error_message = "Keep the dashboard small (free tier: 3 dashboards, 50 metrics each)."
  }
}

run "lab_controller_is_least_privilege" {
  command = apply # mocked: nothing is created

  assert {
    condition = toset(flatten([
      for s in module.incidents.lab_controller_policy.Statement : s.Resource
      if contains(s.Action, "ssm:SendCommand") && s.Sid == "TwoLabDocumentsOnly"
    ])) == toset(["arn:aws:ssm:ap-southeast-1:111122223333:document/Opsentra-Lab-StopNginx", "arn:aws:ssm:ap-southeast-1:111122223333:document/Opsentra-Lab-RestartNginx"])
    error_message = "The lab controller may send exactly the two lab documents, no prefix wildcard."
  }
  assert {
    condition = alltrue([
      for s in module.incidents.lab_controller_policy.Statement : s.Condition.StringEquals["ssm:resourceTag/opsentra:lab"] == "true"
      if s.Sid == "OnLabInstancesOnly"
    ])
    error_message = "SendCommand targets must carry opsentra:lab=true."
  }
  assert {
    condition = alltrue(flatten([
      for s in module.incidents.lab_controller_policy.Statement : [
        for a in s.Action : contains(["ssm:DescribeInstanceInformation", "ssm:GetCommandInvocation", "ec2:DescribeInstances"], a)
      ] if s.Resource == "*"
    ]))
    error_message = "Only describe and status calls (no resource-level support) may use a wildcard resource."
  }
  assert {
    condition = !anytrue(flatten([
      for s in module.incidents.lab_controller_policy.Statement : [
        for a in s.Action : contains(["dynamodb:DeleteItem", "ssm:StartSession", "ssm:CreateDocument", "ssm:UpdateDocument", "ec2:TerminateInstances", "ec2:RunInstances"], a)
      ]
    ]))
    error_message = "The lab controller cannot delete data, open sessions, change documents or manage instances."
  }
}

run "github_oidc_is_pinned_to_this_repo" {
  command = apply # mocked: nothing is created

  assert {
    condition = toset(module.ci.plan_trust_policy.Statement[0].Condition.StringEquals["token.actions.githubusercontent.com:sub"]) == toset([
      "repo:jervilangelo/opsentra:pull_request",
      "repo:jervilangelo/opsentra:ref:refs/heads/main",
    ])
    error_message = "OIDC trust must name exactly this repo's PRs and main branch."
  }
  assert {
    condition     = module.ci.plan_trust_policy.Statement[0].Condition.StringEquals["token.actions.githubusercontent.com:aud"] == "sts.amazonaws.com"
    error_message = "OIDC audience must be sts.amazonaws.com."
  }
  assert {
    condition     = !can(module.ci.plan_trust_policy.Statement[0].Condition.StringLike)
    error_message = "No wildcard (StringLike) subject matching."
  }
  assert {
    condition     = module.ci.plan_managed_policies == ["arn:aws:iam::aws:policy/ReadOnlyAccess"]
    error_message = "The plan role is read-only."
  }
  assert {
    condition     = contains([for s in module.ci.plan_state_policy.Statement : s.Effect], "Deny")
    error_message = "The plan role must be denied writes to state."
  }
}

run "cognito_is_closed_and_pkce_only" {
  command = apply # mocked: nothing is created

  assert {
    condition     = module.auth.self_signup_disabled
    error_message = "Only admins may create users."
  }
  assert {
    condition     = module.auth.spa_client.generate_secret == false
    error_message = "The browser client must not have a secret."
  }
  assert {
    condition     = toset(module.auth.spa_client.allowed_oauth_flows) == toset(["code"])
    error_message = "The browser client uses the authorization code flow (with PKCE) only."
  }
  assert {
    condition     = !contains(module.auth.spa_client.explicit_auth_flows, "ALLOW_USER_PASSWORD_AUTH")
    error_message = "No plain password auth on the browser client."
  }
  assert {
    condition     = toset(module.auth.group_names) == toset(["admin", "operator", "viewer"])
    error_message = "Roles are exactly viewer, operator and admin."
  }
}

run "cost_guardrails" {
  command = apply # mocked: nothing is created

  assert {
    condition     = alltrue([for m in values(module.tables.billing_modes) : m == "PAY_PER_REQUEST"])
    error_message = "DynamoDB tables must be on-demand."
  }
  assert {
    condition     = length(module.tables.table_names) == 6
    error_message = "Exactly the five §4.3 tables."
  }
  assert {
    condition     = alltrue([for d in module.api.log_retention_days : d > 0 && d <= 30])
    error_message = "Every log group needs a short, finite retention."
  }
  assert {
    condition     = length(module.budget) == 0
    error_message = "No Opsentra budget by default (shared account, ADR-014)."
  }
}

run "optional_budget_ignores_credits" {
  command = apply # mocked: nothing is created

  variables {
    create_budget      = true
    budget_alert_email = "alerts@example.com"
  }

  assert {
    condition     = module.budget[0].includes_credits == false
    error_message = "Budget alerts must ignore credits so they reflect real usage."
  }
}

run "budget_needs_an_email" {
  command = plan

  variables {
    create_budget = true
  }

  expect_failures = [var.budget_alert_email]
}

run "wildcard_cors_is_rejected" {
  command = plan

  variables {
    frontend_origins = ["*"]
  }

  expect_failures = [var.frontend_origins]
}

run "other_regions_are_rejected" {
  command = plan

  variables {
    region = "us-west-2"
  }

  expect_failures = [var.region]
}

run "incident_pipeline_guardrails" {
  command = apply # mocked: nothing is created

  assert {
    condition = !anytrue(flatten([
      for p in [module.incidents.ingest_policy, module.incidents.reconciler_policy, module.incidents.coordinator_policy, module.api.lambda_policy] : [
        for st in p.Statement : [for a in st.Action : strcontains(lower(a), "delete")]
      ]
    ]))
    error_message = "No principal may delete items: the audit trail is append-only."
  }
  assert {
    condition     = module.incidents.has_dlq
    error_message = "Failed ingest events must land in the DLQ."
  }
  assert {
    condition     = module.incidents.reconcile_schedule == "rate(2 minutes)"
    error_message = "The reconciler runs every 2 minutes."
  }
  assert {
    condition     = one([for st in module.incidents.reconciler_policy.Statement : st.Resource if st.Sid == "DescribeLabAlarms"]) == "arn:aws:cloudwatch:ap-southeast-1:111122223333:alarm:opsentra-lab-*"
    error_message = "The reconciler may only describe lab alarms."
  }
  assert {
    condition     = alltrue([for st in module.incidents.ingest_policy.Statement : st.Resource != "*" || st.Sid == "UseAwsManagedSnsKey"])
    error_message = "Only the KMS via-SNS statement may use a wildcard resource."
  }
}

run "remediation_guardrails" {
  command = apply # mocked: nothing is created

  assert {
    condition     = module.incidents.coordinator_has_dlq
    error_message = "Failed coordinator invocations must land in a DLQ."
  }
  assert {
    condition     = !anytrue([for st in module.incidents.ingest_policy.Statement : contains(st.Action, "ssm:SendCommand")])
    error_message = "The ingest Lambda never runs commands."
  }
  assert {
    condition = alltrue(flatten([
      for p in [module.incidents.coordinator_policy, module.incidents.reconciler_policy] : [
        for st in p.Statement : (
          st.Resource == "arn:aws:ssm:ap-southeast-1:111122223333:document/Opsentra-Lab-RestartNginx" ||
          (st.Resource == "arn:aws:ec2:ap-southeast-1:111122223333:instance/*" && st.Condition.StringEquals["ssm:resourceTag/opsentra:lab"] == "true")
        ) if contains(st.Action, "ssm:SendCommand")
      ]
    ]))
    error_message = "Coordinator and reconciler: SendCommand only for the RestartNginx runbook on instances tagged opsentra:lab=true (Phase 9, F4)."
  }
  assert {
    condition = !anytrue(flatten([
      for p in [module.incidents.coordinator_policy, module.incidents.reconciler_policy] : [
        for st in p.Statement : strcontains(jsonencode(st.Resource), "StopNginx") || strcontains(jsonencode(st.Resource), "Opsentra-Lab-*")
      ]
    ]))
    error_message = "Only the lab controller may send the fault-injection document."
  }
  assert {
    condition = !anytrue(flatten([
      for p in [module.incidents.coordinator_policy, module.incidents.reconciler_policy] : [
        for st in p.Statement : contains(st.Action, "ssm:SendCommand") && st.Resource == "*"
      ]
    ]))
    error_message = "SendCommand is never granted on a wildcard resource."
  }
  assert {
    condition = alltrue([
      for st in module.incidents.coordinator_policy.Statement : st.Resource != "*" || contains(["UseAwsManagedSnsKey", "ReadCommandStatusAndTargets"], st.Sid)
    ])
    error_message = "Only the KMS via-SNS and read-only status statements may use a wildcard resource."
  }
  assert {
    condition = alltrue(flatten([
      for st in module.incidents.coordinator_policy.Statement : [
        for a in st.Action : !contains(["ssm:StartSession", "ssm:StartAutomationExecution", "ssm:CreateDocument", "ssm:UpdateDocument", "ec2:RunInstances", "ec2:TerminateInstances"], a)
      ]
    ]))
    error_message = "No sessions, automations, document changes or instance lifecycle actions."
  }
}
