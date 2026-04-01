variable "aws_region" {
  description = "AWS region for Chime SDK Voice (SMA + Lambda)"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Environment label for resource naming (e.g. loadtest, dev)"
  type        = string
  default     = "loadtest"
}

variable "project_name" {
  description = "Project prefix for resource names"
  type        = string
  default     = "serverless-artillery"
}

variable "sip_media_application_name" {
  description = "Optional explicit SMA name; default is derived from project + environment + region"
  type        = string
  default     = ""
}

variable "lambda_timeout_seconds" {
  description = "SMA handler Lambda timeout"
  type        = number
  default     = 30
}

variable "tags" {
  description = "Additional tags for all resources"
  type        = map(string)
  default     = {}
}


variable "lambda_log_retention_days" {
  description = "CloudWatch Logs retention (days) for the SMA Lambda log group"
  type        = number
  default     = 14
}
