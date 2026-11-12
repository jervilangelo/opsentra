variable "region" {
  description = "The one region Opsentra uses."
  type        = string
  default     = "ap-southeast-1"

  validation {
    condition     = var.region == "ap-southeast-1"
    error_message = "Opsentra runs in ap-southeast-1 only (CLAUDE.md)."
  }
}

variable "account_id" {
  description = "The AWS account Opsentra is allowed to touch. Set in terraform.tfvars (gitignored); never commit it."
  type        = string

  validation {
    condition     = can(regex("^[0-9]{12}$", var.account_id))
    error_message = "account_id must be a 12-digit AWS account ID."
  }
}

variable "noncurrent_version_days" {
  description = "Days to keep old state versions for recovery."
  type        = number
  default     = 90
}
