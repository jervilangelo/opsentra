variable "region" {
  type    = string
  default = "ap-southeast-1"

  validation {
    condition     = var.region == "ap-southeast-1"
    error_message = "Opsentra runs in ap-southeast-1 only (CLAUDE.md)."
  }
}

variable "account_id" {
  description = "The only AWS account this root may touch. terraform.tfvars only; never commit."
  type        = string

  validation {
    condition     = can(regex("^[0-9]{12}$", var.account_id))
    error_message = "account_id must be a 12-digit AWS account ID."
  }
}

variable "environment" {
  type    = string
  default = "dev"
}

variable "state_bucket" {
  description = "Name of the Terraform state bucket (output of bootstrap-state)."
  type        = string
}

variable "github_repository" {
  type    = string
  default = "jervilangelo/opsentra"
}

variable "create_github_oidc_provider" {
  type    = bool
  default = true
}

variable "existing_github_oidc_provider_arn" {
  type    = string
  default = ""
}

variable "frontend_origins" {
  description = "Exact browser origins: local dev and the GitHub Pages demo."
  type        = list(string)
  default     = ["http://localhost:5173", "https://jervilangelo.github.io"]

  validation {
    condition     = alltrue([for o in var.frontend_origins : o != "*" && can(regex("^https?://[^/*]+$", o))])
    error_message = "Origins must be exact (scheme://host[:port]); no wildcard or path."
  }
}

variable "frontend_base_path" {
  description = "Path the dashboard is served from on GitHub Pages."
  type        = string
  default     = "/opsentra/"
}

variable "create_budget" {
  description = "Create an Opsentra AWS Budget. Off: the account is shared and already has budgets (ADR-014)."
  type        = bool
  default     = false
}

variable "budget_alert_email" {
  description = "Required only when create_budget is true."
  type        = string
  default     = ""
  sensitive   = true

  validation {
    condition     = !var.create_budget || can(regex("^[^@ ]+@[^@ ]+$", var.budget_alert_email))
    error_message = "Set budget_alert_email when create_budget is true."
  }
}

variable "monthly_budget_usd" {
  type    = number
  default = 5
}

variable "alert_email" {
  description = "Incident alert email (SNS). terraform.tfvars only; empty means no subscriber."
  type        = string
  default     = ""
  sensitive   = true
}

variable "enable_integration_test_client" {
  type    = bool
  default = true
}
