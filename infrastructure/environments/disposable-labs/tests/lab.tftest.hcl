# Lab guardrails with mocked providers: no AWS credentials, nothing is created.
# Run: terraform init -backend=false && terraform test

mock_provider "aws" {
  mock_data "aws_ssm_parameter" {
    defaults = { value = "ami-0123456789abcdef0" }
  }
  mock_resource "aws_instance" {
    defaults = {
      id        = "i-0123456789abcdef0"
      arn       = "arn:aws:ec2:ap-southeast-1:111122223333:instance/i-0123456789abcdef0"
      public_ip = "203.0.113.10"
    }
  }
  mock_resource "aws_iam_role" {
    defaults = { arn = "arn:aws:iam::111122223333:role/mock" }
  }
  mock_resource "aws_cloudwatch_log_group" {
    defaults = { arn = "arn:aws:logs:ap-southeast-1:111122223333:log-group:mock" }
  }
  mock_resource "aws_lambda_function" {
    defaults = {
      arn     = "arn:aws:lambda:ap-southeast-1:111122223333:function:mock"
      version = "1"
    }
  }
  mock_resource "aws_lambda_alias" {
    defaults = { arn = "arn:aws:lambda:ap-southeast-1:111122223333:function:mock:live" }
  }
}

override_data {
  target = data.terraform_remote_state.control_plane
  values = {
    outputs = {
      table_names = { resources = "opsentra-dev-resources" }
      table_arns  = { resources = "arn:aws:dynamodb:ap-southeast-1:111122223333:table/opsentra-dev-resources" }
    }
  }
}

variables {
  account_id     = "111122223333"
  state_bucket   = "opsentra-tfstate-111122223333-ap-southeast-1"
  lab_expires_at = "2099-01-01T00:00:00Z" # overridden per run where validation matters
}

run "lab_is_locked_down" {
  command = apply # mocked: nothing is created

  variables {
    lab_expires_at = timeadd(timestamp(), "2h")
  }

  assert {
    condition     = length(aws_vpc_security_group_ingress_rule.web) == 1 && aws_vpc_security_group_ingress_rule.web["http"].from_port == 80 && aws_vpc_security_group_ingress_rule.web["http"].to_port == 80
    error_message = "The only ingress is HTTP 80."
  }
  assert {
    condition     = !anytrue([for r in aws_vpc_security_group_ingress_rule.web : r.from_port <= 22 && r.to_port >= 22])
    error_message = "No SSH ingress, ever."
  }
  assert {
    condition     = aws_instance.web.metadata_options[0].http_tokens == "required"
    error_message = "IMDSv2 must be required."
  }
  assert {
    condition     = aws_instance.web.root_block_device[0].encrypted && aws_instance.web.root_block_device[0].delete_on_termination
    error_message = "Root volume must be encrypted and deleted with the instance."
  }
  assert {
    condition     = aws_instance.web.instance_initiated_shutdown_behavior == "terminate"
    error_message = "The self-shutdown at expiry must terminate the instance."
  }
  assert {
    condition     = strcontains(local.user_data, "shutdown -h") && !strcontains(local.user_data, "authorized_keys")
    error_message = "User data schedules self-termination and adds no SSH keys."
  }
  assert {
    condition     = contains(["t4g.nano", "t4g.micro"], aws_instance.web.instance_type)
    error_message = "Cost guardrail on instance type."
  }
}

run "probe_is_least_privilege" {
  command = apply # mocked

  variables {
    lab_expires_at = timeadd(timestamp(), "2h")
  }

  assert {
    condition = alltrue([
      for s in local.probe_policy.Statement :
      s.Resource != "*" || contains(["OneMetricNamespace", "DescribeInstances"], s.Sid)
    ])
    error_message = "Only PutMetricData (namespace-conditioned) and DescribeInstances may use a wildcard resource."
  }
  assert {
    condition     = one([for s in local.probe_policy.Statement : s.Condition.StringEquals["cloudwatch:namespace"] if s.Sid == "OneMetricNamespace"]) == "Opsentra/Lab"
    error_message = "Metrics are limited to the Opsentra/Lab namespace."
  }
  assert {
    condition     = one([for s in local.probe_policy.Statement : s.Action if s.Sid == "UpdateOnlyThisRegistryItem"]) == ["dynamodb:UpdateItem"]
    error_message = "The probe may only update, never put or delete, registry items."
  }
  assert {
    condition     = strcontains(aws_lambda_function.probe.environment[0].variables["TARGET_URL"], aws_instance.web.public_ip)
    error_message = "The probe target is fixed by Terraform to the lab instance."
  }
}

run "alarm_and_schedule" {
  command = apply # mocked

  variables {
    lab_expires_at = timeadd(timestamp(), "2h")
  }

  assert {
    condition     = aws_cloudwatch_metric_alarm.nginx.evaluation_periods == 3 && aws_cloudwatch_metric_alarm.nginx.period == 60 && aws_cloudwatch_metric_alarm.nginx.threshold == 1
    error_message = "Alarm after 3 failed one-minute probes."
  }
  assert {
    condition     = aws_cloudwatch_metric_alarm.nginx.treat_missing_data == "missing"
    error_message = "Missing probe data must never read as healthy."
  }
  assert {
    condition     = aws_scheduler_schedule.probe.schedule_expression == "rate(1 minute)" && aws_scheduler_schedule.probe.end_date == var.lab_expires_at
    error_message = "The probe runs every minute and ends at lab expiry."
  }
  assert {
    condition     = jsondecode(aws_cloudwatch_event_rule.alarm_state.event_pattern).detail.alarmName[0].prefix == "opsentra-lab-"
    error_message = "The event rule only matches Opsentra lab alarms."
  }
  assert {
    condition     = length(local.registry) == 2 && local.registry.web.environment.S == "lab"
    error_message = "Exactly the two lab resources are registered."
  }
}

run "expiry_must_be_soon" {
  command = plan

  variables {
    lab_expires_at = timeadd(timestamp(), "13h")
  }

  expect_failures = [var.lab_expires_at]
}

run "expiry_must_be_in_the_future" {
  command = plan

  variables {
    lab_expires_at = "2020-01-01T00:00:00Z"
  }

  expect_failures = [var.lab_expires_at]
}

run "only_small_instances" {
  command = plan

  variables {
    lab_expires_at = timeadd(timestamp(), "2h")
    instance_type  = "m7g.large"
  }

  expect_failures = [var.instance_type]
}
