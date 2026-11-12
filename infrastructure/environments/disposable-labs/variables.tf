variable "region" {
  type    = string
  default = "ap-southeast-1"

  validation {
    condition     = var.region == "ap-southeast-1"
    error_message = "Opsentra runs in ap-southeast-1 only (CLAUDE.md)."
  }
}

variable "account_id" {
  description = "terraform.tfvars only; never commit."
  type        = string

  validation {
    condition     = can(regex("^[0-9]{12}$", var.account_id))
    error_message = "account_id must be a 12-digit AWS account ID."
  }
}

variable "state_bucket" {
  description = "Terraform state bucket; the control-plane state is read from it."
  type        = string
}

variable "lab_expires_at" {
  description = "RFC 3339 UTC time the lab ends. The instance terminates itself then, the probe schedule ends, and every resource is tagged with it. Must be in the future and at most 12 hours away."
  type        = string

  validation {
    condition = (
      can(timecmp(var.lab_expires_at, plantimestamp())) &&
      timecmp(var.lab_expires_at, plantimestamp()) > 0 &&
      timecmp(var.lab_expires_at, timeadd(plantimestamp(), "12h")) <= 0
    )
    error_message = "lab_expires_at must be an RFC 3339 time in the future and at most 12 hours from now, e.g. 2026-11-12T12:00:00Z."
  }
}

variable "instance_type" {
  type    = string
  default = "t4g.nano"

  validation {
    condition     = contains(["t4g.nano", "t4g.micro"], var.instance_type)
    error_message = "Only t4g.nano or t4g.micro (cost guardrail)."
  }
}

variable "probe_rate_minutes" {
  type    = number
  default = 1
}

variable "log_retention_days" {
  type    = number
  default = 14
}
