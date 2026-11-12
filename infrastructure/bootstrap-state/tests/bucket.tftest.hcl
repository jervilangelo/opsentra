# Plan-level checks with a mocked provider: no AWS credentials needed.
mock_provider "aws" {}

variables {
  account_id = "111122223333"
}

run "state_bucket_is_locked_down" {
  command = plan

  assert {
    condition     = aws_s3_bucket.state.bucket == "opsentra-tfstate-111122223333-ap-southeast-1"
    error_message = "Bucket name must be derived from account and region."
  }
  assert {
    condition     = aws_s3_bucket_versioning.state.versioning_configuration[0].status == "Enabled"
    error_message = "State bucket must be versioned for recovery."
  }
  assert {
    condition = alltrue([
      aws_s3_bucket_public_access_block.state.block_public_acls,
      aws_s3_bucket_public_access_block.state.block_public_policy,
      aws_s3_bucket_public_access_block.state.ignore_public_acls,
      aws_s3_bucket_public_access_block.state.restrict_public_buckets,
    ])
    error_message = "All four public access blocks must be on."
  }
  assert {
    condition     = one([for r in aws_s3_bucket_server_side_encryption_configuration.state.rule : one(r.apply_server_side_encryption_by_default).sse_algorithm]) == "AES256"
    error_message = "State must be encrypted at rest."
  }
  assert {
    condition     = aws_s3_bucket_ownership_controls.state.rule[0].object_ownership == "BucketOwnerEnforced"
    error_message = "ACLs must be disabled."
  }
  assert {
    condition     = contains([for s in local.bucket_policy.Statement : s.Sid], "DenyInsecureTransport")
    error_message = "Bucket policy must deny non-TLS access."
  }
}

run "wrong_region_is_rejected" {
  command = plan

  variables {
    region = "us-east-1"
  }

  expect_failures = [var.region]
}
