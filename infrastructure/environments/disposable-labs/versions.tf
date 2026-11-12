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
  }

  # Partial config in backend.hcl (gitignored); key = disposable-labs/terraform.tfstate.
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
      "opsentra:component"   = "lab"
      "opsentra:environment" = "lab"
      "opsentra:lab"         = "true"
      "opsentra:expiresAt"   = local.expires_at
    }
  }
}
