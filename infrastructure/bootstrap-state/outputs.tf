output "state_bucket" {
  description = "Put this in each root's backend.hcl (gitignored)."
  value       = aws_s3_bucket.state.bucket
}

output "state_bucket_arn" {
  value = aws_s3_bucket.state.arn
}
