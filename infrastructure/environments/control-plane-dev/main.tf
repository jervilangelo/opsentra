# Opsentra control plane, dev (blueprint §3.2, §9.1). Long-lived, low-traffic,
# no VPC, NAT, load balancer, RDS or KMS keys. Every write to this account goes
# through `terraform apply` after the owner approves the plan.

locals {
  name_prefix = "opsentra-${var.environment}"

  # Sign-in callbacks: local dev plus the GitHub Pages demo path.
  callback_urls = [
    for o in var.frontend_origins :
    startswith(o, "http://localhost") ? "${o}/auth/callback" : "${o}${var.frontend_base_path}auth/callback"
  ]
  logout_urls = [
    for o in var.frontend_origins :
    startswith(o, "http://localhost") ? "${o}/" : "${o}${var.frontend_base_path}"
  ]
}

module "tables" {
  source      = "../../modules/dynamodb-tables"
  name_prefix = local.name_prefix
}

module "auth" {
  source                         = "../../modules/cognito"
  name_prefix                    = local.name_prefix
  callback_urls                  = local.callback_urls
  logout_urls                    = local.logout_urls
  enable_integration_test_client = var.enable_integration_test_client
}

module "api" {
  source             = "../../modules/api"
  name_prefix        = local.name_prefix
  region             = var.region
  account_id         = var.account_id
  environment        = var.environment
  source_dir         = "${path.root}/../../../services/api/src"
  build_dir          = "${path.root}/.build"
  jwt_issuer         = module.auth.issuer
  jwt_audience       = module.auth.client_ids
  cors_allow_origins = var.frontend_origins
  read_tables = {
    for k in ["resources", "incidents", "audit"] :
    k => { name = module.tables.table_names[k], arn = module.tables.table_arns[k] }
  }
}

module "ci" {
  source                     = "../../modules/github-oidc"
  name_prefix                = local.name_prefix
  github_repository          = var.github_repository
  state_bucket_arn           = "arn:aws:s3:::${var.state_bucket}"
  create_oidc_provider       = var.create_github_oidc_provider
  existing_oidc_provider_arn = var.existing_github_oidc_provider_arn
}

module "budget" {
  count             = var.create_budget ? 1 : 0
  source            = "../../modules/budget"
  name_prefix       = local.name_prefix
  monthly_limit_usd = var.monthly_budget_usd
  alert_email       = var.budget_alert_email
}
