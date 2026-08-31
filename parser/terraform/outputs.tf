output "ecr_repository_url" {
  description = "Push images here before the first deploy: docker push <this>:latest"
  value       = aws_ecr_repository.parser.repository_url
}

output "ecs_cluster_name" {
  value = aws_ecs_cluster.this.name
}

output "ecs_service_name" {
  value = aws_ecs_service.parser.name
}

output "parser_url" {
  description = "Set this as PARSER_URL in Vercel. The Lambda keeps this name pointed at the task's current public IP (allow ~30-60s after a new task starts for the record to update, given the 60s TTL)."
  value       = "http://${var.parser_dns_name}:${var.container_port}"
}

output "get_current_public_ip_command" {
  description = "Manual fallback / debugging: look up the task's current public IP directly instead of via DNS."
  value       = "aws ecs list-tasks --cluster ${aws_ecs_cluster.this.name} --service-name ${aws_ecs_service.parser.name} --query 'taskArns[0]' --output text | xargs -I{} aws ecs describe-tasks --cluster ${aws_ecs_cluster.this.name} --tasks {} --query 'tasks[0].attachments[0].details[?name==`networkInterfaceId`].value' --output text | xargs -I{} aws ec2 describe-network-interfaces --network-interface-ids {} --query 'NetworkInterfaces[0].Association.PublicIp' --output text"
}
