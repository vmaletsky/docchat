data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

# --- Container image ---

resource "aws_ecr_repository" "parser" {
  name                 = var.project_name
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

# --- Networking ---

resource "aws_security_group" "parser" {
  name        = "${var.project_name}-service"
  description = "Allow inbound traffic to the parser service"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description = "Parser API"
    from_port   = var.container_port
    to_port     = var.container_port
    protocol    = "tcp"
    cidr_blocks = var.allowed_cidr_blocks
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# --- Secret ---

resource "aws_ssm_parameter" "parser_api_secret" {
  name  = "/${var.project_name}/parser-api-secret"
  type  = "SecureString"
  value = var.parser_api_secret
}

# --- Logs ---

resource "aws_cloudwatch_log_group" "parser" {
  name              = "/ecs/${var.project_name}"
  retention_in_days = 14
}

# --- IAM ---

data "aws_iam_policy_document" "ecs_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

# Execution role: pulls the image and writes logs, reads the SSM secret to inject it
resource "aws_iam_role" "execution" {
  name               = "${var.project_name}-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume_role.json
}

resource "aws_iam_role_policy_attachment" "execution_managed" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "execution_ssm" {
  name = "${var.project_name}-execution-ssm"
  role = aws_iam_role.execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["ssm:GetParameters"]
      Resource = [aws_ssm_parameter.parser_api_secret.arn]
    }]
  })
}

# Task role: what the running app itself is allowed to do (S3 download only)
resource "aws_iam_role" "task" {
  name               = "${var.project_name}-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume_role.json
}

resource "aws_iam_role_policy" "task_s3" {
  name = "${var.project_name}-task-s3"
  role = aws_iam_role.task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["s3:GetObject", "s3:HeadObject"]
      Resource = ["arn:aws:s3:::${var.s3_bucket_name}/*"]
    }]
  })
}

# --- ECS ---

resource "aws_ecs_cluster" "this" {
  name = var.project_name
}

resource "aws_ecs_task_definition" "parser" {
  family                   = var.project_name
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.cpu
  memory                   = var.memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  container_definitions = jsonencode([
    {
      name      = "parser"
      image     = "${aws_ecr_repository.parser.repository_url}:${var.image_tag}"
      essential = true

      portMappings = [
        {
          containerPort = var.container_port
          protocol      = "tcp"
        }
      ]

      environment = [
        { name = "MAX_FILE_BYTES", value = tostring(var.max_file_bytes) },
        { name = "LOG_LEVEL", value = var.log_level },
      ]

      secrets = [
        {
          name      = "PARSER_API_SECRET"
          valueFrom = aws_ssm_parameter.parser_api_secret.arn
        }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.parser.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "parser"
        }
      }
    }
  ])
}

resource "aws_ecs_service" "parser" {
  name            = var.project_name
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.parser.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = data.aws_subnets.default.ids
    security_groups  = [aws_security_group.parser.id]
    assign_public_ip = true
  }
}
