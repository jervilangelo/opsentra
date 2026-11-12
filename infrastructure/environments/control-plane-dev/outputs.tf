# Public identifiers only. These become VITE_* values in Phase 4 (§9.3).

output "api_url" {
  value = module.api.api_url
}

output "user_pool_id" {
  value = module.auth.user_pool_id
}

output "spa_client_id" {
  value = module.auth.spa_client_id
}

output "integration_client_id" {
  value = module.auth.integration_client_id
}

output "cognito_domain" {
  value = module.auth.domain
}

output "table_names" {
  value = module.tables.table_names
}

output "table_arns" {
  description = "Read by the disposable-labs root (remote state) to register lab resources."
  value       = module.tables.table_arns
}

output "gha_plan_role_arn" {
  description = "Set as the GitHub repository secret AWS_PLAN_ROLE_ARN (it contains the account ID)."
  value       = module.ci.plan_role_arn
}
