terraform {
  required_version = ">= 1.10.0" # S3 native state locking (use_lockfile)

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  # One-time bootstrap: start with local state, apply, then uncomment and run
  #   terraform init -migrate-state -backend-config=../environments/control-plane-dev/backend.hcl
  # with key = "bootstrap/terraform.tfstate". See docs/operations/terraform.md.
  # backend "s3" {}
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
