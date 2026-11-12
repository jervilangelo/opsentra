# Cognito user pool for Live mode (blueprint §5, §9.3). Users are created by an
# admin only; there is no self sign-up. Roles are the groups viewer, operator
# and admin; the API reads them from the verified token (never from a request).

terraform {
  required_providers {
    aws    = { source = "hashicorp/aws" }
    random = { source = "hashicorp/random" }
  }
}

variable "name_prefix" {
  type = string
}

variable "callback_urls" {
  description = "Exact URLs the browser may return to after sign-in."
  type        = list(string)
}

variable "logout_urls" {
  type = list(string)
}

variable "enable_integration_test_client" {
  description = "Server-side client used by the integration tests (AdminInitiateAuth via IAM). No secret, never used by the browser."
  type        = bool
  default     = true
}

resource "aws_cognito_user_pool" "this" {
  name                = "${var.name_prefix}-users"
  user_pool_tier      = "LITE" # cheapest tier; groups and code + PKCE need nothing more
  deletion_protection = "INACTIVE"
  mfa_configuration   = "OPTIONAL"

  admin_create_user_config {
    allow_admin_create_user_only = true
  }

  username_configuration {
    case_sensitive = false
  }

  password_policy {
    minimum_length                   = 14
    require_lowercase                = true
    require_uppercase                = true
    require_numbers                  = true
    require_symbols                  = true
    temporary_password_validity_days = 3
  }

  software_token_mfa_configuration {
    enabled = true
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "admin_only"
      priority = 1
    }
  }

  tags = {
    "opsentra:component" = "auth"
  }
}

locals {
  groups = {
    viewer   = { precedence = 30, description = "Read live resources and incidents." }
    operator = { precedence = 20, description = "Acknowledge incidents and request remediation." }
    admin    = { precedence = 10, description = "Approve remediation and run lab scenarios." }
  }
}

resource "aws_cognito_user_group" "this" {
  for_each     = local.groups
  name         = each.key
  user_pool_id = aws_cognito_user_pool.this.id
  precedence   = each.value.precedence
  description  = each.value.description
}

resource "random_id" "domain" {
  byte_length = 3
}

resource "aws_cognito_user_pool_domain" "this" {
  domain       = "${var.name_prefix}-${random_id.domain.hex}"
  user_pool_id = aws_cognito_user_pool.this.id
}

# Public browser client: Authorization Code + PKCE, no client secret (§9.3).
resource "aws_cognito_user_pool_client" "spa" {
  name         = "${var.name_prefix}-dashboard"
  user_pool_id = aws_cognito_user_pool.this.id

  generate_secret                      = false
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "profile"]
  supported_identity_providers         = ["COGNITO"]
  callback_urls                        = var.callback_urls
  logout_urls                          = var.logout_urls
  explicit_auth_flows                  = ["ALLOW_REFRESH_TOKEN_AUTH"]
  prevent_user_existence_errors        = "ENABLED"
  enable_token_revocation              = true

  access_token_validity  = 60
  id_token_validity      = 60
  refresh_token_validity = 1
  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }
}

# Integration tests only: AdminInitiateAuth needs IAM credentials, so this
# client cannot be used from a browser even though it has no secret.
resource "aws_cognito_user_pool_client" "integration" {
  count        = var.enable_integration_test_client ? 1 : 0
  name         = "${var.name_prefix}-integration-tests"
  user_pool_id = aws_cognito_user_pool.this.id

  generate_secret               = false
  explicit_auth_flows           = ["ALLOW_ADMIN_USER_PASSWORD_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"]
  prevent_user_existence_errors = "ENABLED"
  enable_token_revocation       = true
  access_token_validity         = 15
  id_token_validity             = 15
  refresh_token_validity        = 1
  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }
}

output "user_pool_id" {
  value = aws_cognito_user_pool.this.id
}

output "user_pool_arn" {
  value = aws_cognito_user_pool.this.arn
}

output "issuer" {
  value = "https://${aws_cognito_user_pool.this.endpoint}"
}

output "spa_client_id" {
  value = aws_cognito_user_pool_client.spa.id
}

output "integration_client_id" {
  value = try(aws_cognito_user_pool_client.integration[0].id, null)
}

output "client_ids" {
  description = "Every client whose tokens the API accepts."
  value       = compact([aws_cognito_user_pool_client.spa.id, try(aws_cognito_user_pool_client.integration[0].id, "")])
}

output "domain" {
  value = aws_cognito_user_pool_domain.this.domain
}

output "spa_client" {
  description = "For tests: the public client's security-relevant settings."
  value = {
    generate_secret     = aws_cognito_user_pool_client.spa.generate_secret
    allowed_oauth_flows = aws_cognito_user_pool_client.spa.allowed_oauth_flows
    explicit_auth_flows = aws_cognito_user_pool_client.spa.explicit_auth_flows
  }
}

output "self_signup_disabled" {
  value = aws_cognito_user_pool.this.admin_create_user_config[0].allow_admin_create_user_only
}

output "group_names" {
  value = sort(keys(aws_cognito_user_group.this))
}
