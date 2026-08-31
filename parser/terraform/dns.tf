# Route53 is intentionally NOT managed as an aws_route53_record resource here.
# The Lambda below owns this record's value via UPSERT calls, since it changes
# on every task replacement; a Terraform-managed record would fight it on
# every `terraform apply` (plan would try to reset it to stale state).

data "archive_file" "update_dns" {
  type        = "zip"
  source_file = "${path.module}/lambda/update_dns.py"
  output_path = "${path.module}/lambda/update_dns.zip"
}

resource "aws_iam_role" "update_dns_lambda" {
  name = "${var.project_name}-update-dns"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "update_dns_lambda" {
  name = "${var.project_name}-update-dns"
  role = aws_iam_role.update_dns_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["ec2:DescribeNetworkInterfaces"]
        Resource = "*"
      },
      {
        Effect   = "Allow"
        Action   = ["route53:ChangeResourceRecordSets"]
        Resource = "arn:aws:route53:::hostedzone/${var.route53_zone_id}"
      },
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "*"
      }
    ]
  })
}

resource "aws_lambda_function" "update_dns" {
  function_name    = "${var.project_name}-update-dns"
  role             = aws_iam_role.update_dns_lambda.arn
  handler          = "update_dns.handler"
  runtime          = "python3.12"
  filename         = data.archive_file.update_dns.output_path
  source_code_hash = data.archive_file.update_dns.output_base64sha256
  timeout          = 30

  environment {
    variables = {
      HOSTED_ZONE_ID = var.route53_zone_id
      RECORD_NAME    = var.parser_dns_name
    }
  }
}

resource "aws_cloudwatch_event_rule" "task_state_change" {
  name        = "${var.project_name}-task-state-change"
  description = "Fires when the parser ECS task reaches RUNNING, so DNS can be updated with its new public IP"

  event_pattern = jsonencode({
    source      = ["aws.ecs"]
    detail-type = ["ECS Task State Change"]
    detail = {
      clusterArn = [aws_ecs_cluster.this.arn]
      lastStatus = ["RUNNING"]
      group      = ["service:${aws_ecs_service.parser.name}"]
    }
  })
}

resource "aws_cloudwatch_event_target" "update_dns" {
  rule      = aws_cloudwatch_event_rule.task_state_change.name
  target_id = "update-dns-lambda"
  arn       = aws_lambda_function.update_dns.arn
}

resource "aws_lambda_permission" "allow_eventbridge" {
  statement_id  = "AllowEventBridgeInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.update_dns.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.task_state_change.arn
}
