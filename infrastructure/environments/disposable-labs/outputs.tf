output "instance_id" {
  value = aws_instance.web.id
}

output "expires_at" {
  value = local.expires_at
}

output "nginx_alarm" {
  value = aws_cloudwatch_metric_alarm.nginx.alarm_name
}

output "probe_function" {
  value = aws_lambda_function.probe.function_name
}

output "probe_schedule" {
  value = aws_scheduler_schedule.probe.name
}

output "alarm_events_log_group" {
  value = aws_cloudwatch_log_group.alarm_events.name
}

output "ssm_documents" {
  value = [aws_ssm_document.stop_nginx.name, aws_ssm_document.restart_nginx.name]
}
