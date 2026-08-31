variable "aws_region" {
  description = "AWS region to deploy into"
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Name prefix for all resources"
  type        = string
  default     = "docchat-parser"
}

variable "image_tag" {
  description = "Docker image tag to deploy (must already exist in ECR before first `terraform apply` of the service)"
  type        = string
  default     = "latest"
}

variable "container_port" {
  description = "Port the FastAPI app listens on"
  type        = number
  default     = 8000
}

variable "cpu" {
  description = "Fargate task CPU units (256 = 0.25 vCPU)"
  type        = number
  default     = 256
}

variable "memory" {
  description = "Fargate task memory in MiB"
  type        = number
  default     = 512
}

variable "desired_count" {
  description = "Number of running tasks"
  type        = number
  default     = 1
}

variable "s3_bucket_name" {
  description = "S3 bucket the parser downloads PDFs from (must match S3_BUCKET used by the Node.js app)"
  type        = string
}

variable "parser_api_secret" {
  description = "Shared secret for the Authorization: Bearer header, matching PARSER_API_SECRET in the Node.js app"
  type        = string
  sensitive   = true
}

variable "max_file_bytes" {
  description = "Max PDF size accepted, in bytes"
  type        = number
  default     = 20971520
}

variable "log_level" {
  description = "Python logging level"
  type        = string
  default     = "INFO"
}

variable "allowed_cidr_blocks" {
  description = "CIDR blocks allowed to reach the parser on container_port. Defaults to open internet since Vercel's outbound IPs aren't static — narrow this if you have a fixed egress IP (e.g. Vercel's Secure Compute)."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "route53_zone_id" {
  description = "Existing public Route53 hosted zone ID to manage the parser's DNS record in (you must already own the domain)"
  type        = string
}

variable "parser_dns_name" {
  description = "Fully-qualified DNS name to point at the parser task, e.g. parser.docchat.example.com"
  type        = string
}
