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
      for s in module.api.lambda_policy.Statement : [for a in s.Action : startswith(a, "logs:")]
    ]))
    error_message = "The API Lambda may only write logs in Phase 3."
  }
  assert {
    condition     = !anytrue([for s in module.api.lambda_policy.Statement : s.Resource == "*"])
    error_message = "No wildcard resources on the Lambda role."
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
    condition     = length(module.tables.table_names) == 5
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
