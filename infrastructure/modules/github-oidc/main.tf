# GitHub Actions → AWS with short-lived OIDC credentials (blueprint §5.1, §9.2).
# Phase 3 creates only a read-only plan role. Its trust is pinned to this exact
# repository: pull requests and the main branch. No wildcard repositories.

terraform {
  required_providers {
    aws = { source = "hashicorp/aws" }
  }
}

variable "name_prefix" {
  type = string
}

variable "github_repository" {
  description = "owner/name of the one repository allowed to assume the role."
  type        = string

  validation {
    condition     = can(regex("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", var.github_repository))
    error_message = "Use an exact owner/name; wildcards are not allowed."
  }
}

variable "state_bucket_arn" {
  type = string
}

variable "create_oidc_provider" {
  description = "Set false if the account already has the GitHub OIDC provider."
  type        = bool
  default     = true
}

variable "existing_oidc_provider_arn" {
  type    = string
  default = ""
}

locals {
  github_host = "token.actions.githubusercontent.com"
}

resource "aws_iam_openid_connect_provider" "github" {
  count          = var.create_oidc_provider ? 1 : 0
  url            = "https://${local.github_host}"
  client_id_list = ["sts.amazonaws.com"]
  tags           = { "opsentra:component" = "ci" }
}

locals {
  provider_arn = var.create_oidc_provider ? aws_iam_openid_connect_provider.github[0].arn : var.existing_oidc_provider_arn

  allowed_subjects = [
    "repo:${var.github_repository}:pull_request",
    "repo:${var.github_repository}:ref:refs/heads/main",
  ]

  plan_trust_policy = {
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = local.provider_arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "${local.github_host}:aud" = "sts.amazonaws.com"
          "${local.github_host}:sub" = local.allowed_subjects
        }
      }
    }]
  }

  # Plan reads state; it never takes the lock (CI runs plan -lock=false).
  plan_state_policy = {
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ReadState"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:ListBucket"]
        Resource = [var.state_bucket_arn, "${var.state_bucket_arn}/*"]
      },
      {
        Sid      = "NeverWriteState"
        Effect   = "Deny"
        Action   = ["s3:PutObject", "s3:DeleteObject"]
        Resource = ["${var.state_bucket_arn}/*"]
      },
    ]
  }
}

resource "aws_iam_role" "plan" {
  name                 = "${var.name_prefix}-gha-plan"
  description          = "GitHub Actions: terraform plan on PRs and main. Read-only."
  assume_role_policy   = jsonencode(local.plan_trust_policy)
  max_session_duration = 3600
  tags                 = { "opsentra:component" = "ci" }
}

resource "aws_iam_role_policy_attachment" "plan_readonly" {
  role       = aws_iam_role.plan.name
  policy_arn = "arn:aws:iam::aws:policy/ReadOnlyAccess"
}

resource "aws_iam_role_policy" "plan_state" {
  name   = "state-read-only"
  role   = aws_iam_role.plan.id
  policy = jsonencode(local.plan_state_policy)
}

output "plan_role_arn" {
  value = aws_iam_role.plan.arn
}

output "plan_trust_policy" {
  value = local.plan_trust_policy
}

output "plan_state_policy" {
  value = local.plan_state_policy
}

output "plan_managed_policies" {
  value = [aws_iam_role_policy_attachment.plan_readonly.policy_arn]
}
