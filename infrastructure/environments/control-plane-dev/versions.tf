terraform {
  required_version = ">= 1.10.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.7"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.7"
    }
  }

  # Partial configuration: bucket, key and region come from backend.hcl
  # (gitignored). Locking uses the S3 lockfile, never DynamoDB (CLAUDE.md).
  backend "s3" {
    use_lockfile = true
    encrypt      = true
  }
}

provider "aws" {
  region              = var.region
  allowed_account_ids = [var.account_id]

  default_tags {
    tags = {
      "opsentra:project"     = "opsentra"
      "opsentra:component"   = "control-plane"
      "opsentra:environment" = var.environment
      "opsentra:lab"         = "false"
    }
  }
}
