# Disposable lab plane (blueprint §3.2, §6.1). Created only for tests and
# destroyed afterwards. Everything here carries opsentra:lab=true and an
# opsentra:expiresAt tag; the instance terminates itself at expiry and the
# health probe disables its own schedule when the lab is gone.

data "terraform_remote_state" "control_plane" {
  backend = "s3"
  config = {
    bucket = var.state_bucket
    key    = "control-plane-dev/terraform.tfstate"
    region = var.region
  }
}

locals {
  name       = "opsentra-lab"
  expires_at = var.lab_expires_at
  marker     = "opsentra-lab ok"

  resources_table_name = data.terraform_remote_state.control_plane.outputs.table_names["resources"]
  resources_table_arn  = data.terraform_remote_state.control_plane.outputs.table_arns["resources"]
  ingest_function_arn  = data.terraform_remote_state.control_plane.outputs.ingest_function_arn
  ingest_function_name = data.terraform_remote_state.control_plane.outputs.ingest_function_name
}

# ---------------------------------------------------------------- network ---
# Own small VPC: one public subnet, an internet gateway, no NAT, no load balancer.

resource "aws_vpc" "lab" {
  #checkov:skip=CKV2_AWS_11:Disposable lab VPC; flow logs cost more than the lab and hold nothing of value.
  cidr_block           = "10.42.0.0/24"
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = { Name = "${local.name}-vpc" }
}

resource "aws_internet_gateway" "lab" {
  vpc_id = aws_vpc.lab.id
  tags   = { Name = "${local.name}-igw" }
}

resource "aws_subnet" "public" {
  #checkov:skip=CKV_AWS_130:Public subnet by design (no NAT); only the health page is reachable.
  vpc_id                  = aws_vpc.lab.id
  cidr_block              = "10.42.0.0/26"
  availability_zone       = "${var.region}a"
  map_public_ip_on_launch = true
  tags                    = { Name = "${local.name}-public" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.lab.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.lab.id
  }
  tags = { Name = "${local.name}-public" }
}

resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}

# The default security group of this VPC allows nothing.
resource "aws_default_security_group" "lab" {
  vpc_id = aws_vpc.lab.id
}

locals {
  # HTTP 80 is the only way in: a static health page with no data (§3.2).
  # The probe runs outside a VPC, so its source address is not fixed.
  # There is deliberately no SSH; access for operations is SSM only.
  ingress_rules = {
    http = { from = 80, to = 80, cidr = "0.0.0.0/0", description = "Health page for the probe" }
  }
  egress_rules = {
    https = { from = 443, to = 443, cidr = "0.0.0.0/0", description = "SSM agent and package repositories" }
    http  = { from = 80, to = 80, cidr = "0.0.0.0/0", description = "Package repositories" }
  }
}

resource "aws_security_group" "web" {
  name        = "${local.name}-web"
  description = "Opsentra lab web server: HTTP in, no SSH"
  vpc_id      = aws_vpc.lab.id
  tags        = { Name = "${local.name}-web" }
}

resource "aws_vpc_security_group_ingress_rule" "web" {
  #checkov:skip=CKV_AWS_260:HTTP 80 serves only a static health page for the probe, which has no fixed source IP (§3.2).
  for_each          = local.ingress_rules
  security_group_id = aws_security_group.web.id
  ip_protocol       = "tcp"
  from_port         = each.value.from
  to_port           = each.value.to
  cidr_ipv4         = each.value.cidr
  description       = each.value.description
}

resource "aws_vpc_security_group_egress_rule" "web" {
  for_each          = local.egress_rules
  security_group_id = aws_security_group.web.id
  ip_protocol       = "tcp"
  from_port         = each.value.from
  to_port           = each.value.to
  cidr_ipv4         = each.value.cidr
  description       = each.value.description
}
