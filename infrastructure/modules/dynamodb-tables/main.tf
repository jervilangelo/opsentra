# Separate small on-demand tables (blueprint §4.3). Encryption uses the
# AWS-owned key (no KMS cost). Point-in-time recovery is off in dev and
# deletion protection is off so `terraform destroy` can remove them (ADR-014).

terraform {
  required_providers {
    aws = { source = "hashicorp/aws" }
  }
}

variable "name_prefix" {
  type = string
}

locals {
  tables = {
    incidents = {
      hash_key   = "incidentId"
      range_key  = null
      attributes = { incidentId = "S", gsi1PK = "S", gsi1SK = "S" }
      gsi        = [{ name = "gsi1", hash_key = "gsi1PK", range_key = "gsi1SK" }]
      ttl        = "ttl"
    }
    resources = {
      hash_key   = "resourceId"
      range_key  = null
      attributes = { resourceId = "S" }
      gsi        = []
      ttl        = null
    }
    audit = {
      hash_key   = "PK"
      range_key  = "SK"
      attributes = { PK = "S", SK = "S" }
      gsi        = []
      ttl        = null
    }
    remediations = {
      hash_key   = "requestId"
      range_key  = null
      attributes = { requestId = "S" }
      gsi        = []
      ttl        = "ttl"
    }
    active-correlations = {
      hash_key   = "correlationKey"
      range_key  = null
      attributes = { correlationKey = "S" }
      gsi        = []
      ttl        = null
    }
    # Phase 7 (ADR-018): Simulation Lab runs plus one LOCK item (one active run, cooldown).
    lab-runs = {
      hash_key   = "runId"
      range_key  = null
      attributes = { runId = "S" }
      gsi        = []
      ttl        = null
    }
  }
}

resource "aws_dynamodb_table" "this" {
  for_each = local.tables

  name                        = "${var.name_prefix}-${each.key}"
  billing_mode                = "PAY_PER_REQUEST"
  hash_key                    = each.value.hash_key
  range_key                   = each.value.range_key
  deletion_protection_enabled = false

  dynamic "attribute" {
    for_each = each.value.attributes
    content {
      name = attribute.key
      type = attribute.value
    }
  }

  dynamic "global_secondary_index" {
    for_each = each.value.gsi
    content {
      name            = global_secondary_index.value.name
      projection_type = "ALL"

      key_schema {
        attribute_name = global_secondary_index.value.hash_key
        key_type       = "HASH"
      }
      key_schema {
        attribute_name = global_secondary_index.value.range_key
        key_type       = "RANGE"
      }
    }
  }

  dynamic "ttl" {
    for_each = each.value.ttl == null ? [] : [each.value.ttl]
    content {
      attribute_name = ttl.value
      enabled        = true
    }
  }

  point_in_time_recovery {
    enabled = false
  }

  tags = {
    "opsentra:component" = "data"
  }
}

output "table_names" {
  value = { for k, t in aws_dynamodb_table.this : k => t.name }
}

output "table_arns" {
  value = { for k, t in aws_dynamodb_table.this : k => t.arn }
}

output "billing_modes" {
  value = { for k, t in aws_dynamodb_table.this : k => t.billing_mode }
}
