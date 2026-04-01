locals {
  app_name = "${var.project_name}-${var.environment}"
  sma_name = (
    var.sip_media_application_name != ""
    ? var.sip_media_application_name
    : "${local.app_name}-sip-media-app-${var.aws_region}"
  )
  lambda_name = "${local.app_name}-sma-handler-${var.aws_region}"
  default_tags = {
    Environment = var.environment
    Project     = var.project_name
    Service     = "chime-load-test-sma"
    ManagedBy   = "terraform"
    Purpose     = "load-test-only"
  }
  tags = merge(local.default_tags, var.tags)
}

data "archive_file" "sma_handler_zip" {
  type        = "zip"
  source_dir  = "${path.module}/lambda_src"
  output_path = "${path.module}/.build/sma-handler.zip"
}

resource "aws_iam_role" "sma_lambda" {
  name = "${local.app_name}-sma-lambda-${var.aws_region}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = "sts:AssumeRole"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })

  tags = local.tags
}

resource "aws_iam_role_policy_attachment" "sma_lambda_basic" {
  role       = aws_iam_role.sma_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_cloudwatch_log_group" "sma_handler" {
  name              = "/aws/lambda/${local.lambda_name}"
  retention_in_days = var.lambda_log_retention_days

  tags = local.tags
}

resource "aws_lambda_function" "sma_handler" {
  function_name = local.lambda_name
  role          = aws_iam_role.sma_lambda.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  timeout       = var.lambda_timeout_seconds

  filename         = data.archive_file.sma_handler_zip.output_path
  source_code_hash = data.archive_file.sma_handler_zip.output_base64sha256

  tags = local.tags

  depends_on = [aws_cloudwatch_log_group.sma_handler]
}

resource "aws_chimesdkvoice_sip_media_application" "load_test" {
  name       = local.sma_name
  aws_region = var.aws_region

  endpoints {
    lambda_arn = aws_lambda_function.sma_handler.arn
  }

  tags = local.tags
}

resource "aws_lambda_permission" "chime_sma_invoke" {
  statement_id  = "AllowChimeSipMediaApplicationInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.sma_handler.function_name
  principal     = "voiceconnector.chime.amazonaws.com"
  source_arn    = aws_chimesdkvoice_sip_media_application.load_test.arn
}
