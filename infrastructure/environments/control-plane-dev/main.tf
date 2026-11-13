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
  extra_source_dirs  = ["${path.root}/../../../services/incidents/src"]
  build_dir          = "${path.root}/.build"
  jwt_issuer         = module.auth.issuer
  jwt_audience       = module.auth.client_ids
  cors_allow_origins = var.frontend_origins
  read_tables = {
    for k in ["resources", "incidents", "audit", "remediations"] :
    k => { name = module.tables.table_names[k], arn = module.tables.table_arns[k] }
  }
  write_tables = {
    incidents    = { name = module.tables.table_names["incidents"], arn = module.tables.table_arns["incidents"] }
    audit        = { name = module.tables.table_names["audit"], arn = module.tables.table_arns["audit"] }
    correlations = { name = module.tables.table_names["active-correlations"], arn = module.tables.table_arns["active-correlations"] }
    remediations = { name = module.tables.table_names["remediations"], arn = module.tables.table_arns["remediations"] }
  }
  coordinator_function = {
    name = module.incidents.coordinator_function_name
    arn  = module.incidents.coordinator_function_arn
  }
  lab_controller_function = {
    name = module.incidents.lab_controller_function_name
    arn  = module.incidents.lab_controller_function_arn
  }
}

module "incidents" {
  source      = "../../modules/incidents"
  name_prefix = local.name_prefix
  region      = var.region
  account_id  = var.account_id
  source_dir  = "${path.root}/../../../services/incidents/src"
  build_dir   = "${path.root}/.build"
  alert_email = var.alert_email
  tables = {
    incidents    = { name = module.tables.table_names["incidents"], arn = module.tables.table_arns["incidents"] }
    audit        = { name = module.tables.table_names["audit"], arn = module.tables.table_arns["audit"] }
    correlations = { name = module.tables.table_names["active-correlations"], arn = module.tables.table_arns["active-correlations"] }
    resources    = { name = module.tables.table_names["resources"], arn = module.tables.table_arns["resources"] }
    remediations = { name = module.tables.table_names["remediations"], arn = module.tables.table_arns["remediations"] }
    lab_runs     = { name = module.tables.table_names["lab-runs"], arn = module.tables.table_arns["lab-runs"] }
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
