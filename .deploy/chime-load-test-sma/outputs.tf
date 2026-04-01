output "sip_media_application_id" {
  description = "Chime SIP Media Application ID — set as LOAD_TEST_SMA_ID for ep-load-test dial-out"
  value       = aws_chimesdkvoice_sip_media_application.load_test.id
}

output "sip_media_application_arn" {
  description = "Chime SIP Media Application ARN"
  value       = aws_chimesdkvoice_sip_media_application.load_test.arn
}

output "lambda_function_name" {
  description = "SMA handler Lambda function name"
  value       = aws_lambda_function.sma_handler.function_name
}

output "lambda_function_arn" {
  description = "SMA handler Lambda ARN"
  value       = aws_lambda_function.sma_handler.arn
}

output "aws_region" {
  description = "Region where SMA and Lambda were created"
  value       = var.aws_region
}
