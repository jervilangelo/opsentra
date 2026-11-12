# ------------------------------------------------------------ web server ---

data "aws_ssm_parameter" "al2023_arm64" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64"
}

locals {
  instance_trust_policy = {
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  }

  # Schedule self-termination at the lab's expiry (shutdown behaviour is
  # terminate), add swap, then install Nginx and publish the health page.
  user_data = <<-EOT
    #!/bin/bash
    set -euo pipefail
    mins=$(( ( $(date -d '${local.expires_at}' +%s) - $(date +%s) ) / 60 ))
    if [ "$mins" -lt 1 ]; then mins=1; fi
    shutdown -h +"$mins" "Opsentra lab expired"
    # t4g.nano has 512 MB; dnf is OOM-killed without swap (seen on first deploy).
    fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
    dnf install -y --setopt=install_weak_deps=False nginx
    printf '%s\n' '${local.marker}' > /usr/share/nginx/html/health
    systemctl enable --now nginx
  EOT
}

resource "aws_iam_role" "instance" {
  name               = "${local.name}-instance"
  assume_role_policy = jsonencode(local.instance_trust_policy)
}

resource "aws_iam_role_policy_attachment" "ssm_core" {
  role       = aws_iam_role.instance.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "instance" {
  name = "${local.name}-instance"
  role = aws_iam_role.instance.name
}

resource "aws_instance" "web" {
  #checkov:skip=CKV_AWS_126:Detailed monitoring is paid; the Opsentra probe is the monitor.
  #checkov:skip=CKV_AWS_135:t4g.nano does not support EBS optimization.
  ami                                  = nonsensitive(data.aws_ssm_parameter.al2023_arm64.value)
  instance_type                        = var.instance_type
  subnet_id                            = aws_subnet.public.id
  vpc_security_group_ids               = [aws_security_group.web.id]
  iam_instance_profile                 = aws_iam_instance_profile.instance.name
  instance_initiated_shutdown_behavior = "terminate"
  user_data                            = local.user_data
  user_data_replace_on_change          = true
  monitoring                           = false

  metadata_options {
    http_tokens                 = "required" # IMDSv2 only
    http_endpoint               = "enabled"
    http_put_response_hop_limit = 1
  }

  root_block_device {
    volume_type           = "gp3"
    volume_size           = 8
    encrypted             = true
    delete_on_termination = true
  }

  tags = {
    Name                 = "${local.name}-web"
    "opsentra:scenario"  = "nginx"
    "opsentra:component" = "lab-web"
  }

  lifecycle {
    ignore_changes = [ami] # a newer AMI does not replace a running lab
  }
}

# ----------------------------------------------------- fixed SSM actions ---
# No parameters: these documents can only ever do exactly this. Phase 6 runs
# RestartNginx after approval; Phase 4 uses StopNginx for the gate test.

resource "aws_ssm_document" "stop_nginx" {
  name            = "Opsentra-Lab-StopNginx"
  document_type   = "Command"
  document_format = "JSON"
  content = jsonencode({
    schemaVersion = "2.2"
    description   = "Opsentra lab: stop Nginx (failure injection, lab instances only)."
    mainSteps = [{
      action = "aws:runShellScript"
      name   = "stopNginx"
      inputs = { runCommand = ["systemctl stop nginx"] }
    }]
  })
}

resource "aws_ssm_document" "restart_nginx" {
  name            = "Opsentra-Lab-RestartNginx"
  document_type   = "Command"
  document_format = "JSON"
  content = jsonencode({
    schemaVersion = "2.2"
    description   = "Opsentra lab: restart Nginx and check the local health page."
    mainSteps = [{
      action = "aws:runShellScript"
      name   = "restartNginx"
      inputs = { runCommand = ["systemctl restart nginx", "curl -fsS http://localhost/health"] }
    }]
  })
}
