terraform {
  required_version = ">= 1.10.0" # S3 native state locking (use_lockfile)

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  # Bootstrap state lives in the bucket it created, under bootstrap/terraform.tfstate
  # (migrated from a one-time local state). On a brand-new account, comment this
  # block out, apply with local state, then migrate. See docs/operations/terraform.md.
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
      "opsentra:component"   = "terraform-state"
      "opsentra:environment" = "shared"
      "opsentra:lab"         = "false"
    }
  }
}
