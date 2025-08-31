# Provider configuration - Simplified for connectivity issues
terraform {
  
  # If you have connectivity issues, comment out the required_providers block
  # and rely on automatic provider installation
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = ">= 2.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

# Variables
variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Environment name"
  type        = string
  default     = "prod"
}

variable "project_name" {
  description = "Project name"
  type        = string
  default     = "resilient-system-multi"
}

# DynamoDB Table
resource "aws_dynamodb_table" "system_state" {
  name           = "SystemState"
  billing_mode   = "PAY_PER_REQUEST"
  hash_key       = "systemId"

  attribute {
    name = "systemId"
    type = "S"
  }

  tags = {
    Name        = "${var.project_name}-system-state"
    Environment = var.environment
    Project     = var.project_name
  }
}

# IAM Role for Lambda
resource "aws_iam_role" "lambda_role" {
  name = "${var.project_name}-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })

  tags = {
    Name        = "${var.project_name}-lambda-role"
    Environment = var.environment
    Project     = var.project_name
  }
}

# IAM Policy for Lambda
resource "aws_iam_role_policy" "lambda_policy" {
  name = "${var.project_name}-lambda-policy"
  role = aws_iam_role.lambda_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "arn:aws:logs:*:*:*"
      },
      {
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:Query",
          "dynamodb:Scan"
        ]
        Resource = aws_dynamodb_table.system_state.arn
      },
      {
        Effect = "Allow"
        Action = [
          "lambda:InvokeFunction"
        ]
        Resource = [
          aws_lambda_function.full_service.arn,
          aws_lambda_function.degraded_service.arn,
          aws_lambda_function.minimal_service.arn
        ]
      }
    ]
  })
}

# Attach basic execution role policy
resource "aws_iam_role_policy_attachment" "lambda_basic_execution" {
  role       = aws_iam_role.lambda_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# Archive Lambda code for multi-lambda
data "archive_file" "lambda_multi_zip" {
  type        = "zip"
  source_dir  = "${path.module}/aws-lambda-multi"
  output_path = "${path.module}/lambda-multi-function.zip"
}

# Orchestrator Lambda Function
resource "aws_lambda_function" "orchestrator" {
  filename         = data.archive_file.lambda_multi_zip.output_path
  function_name    = "${var.project_name}-orchestrator"
  role            = aws_iam_role.lambda_role.arn
  handler         = "orchestrator.handler"
  runtime         = "nodejs18.x"
  timeout         = 30
  memory_size     = 256

  source_code_hash = data.archive_file.lambda_multi_zip.output_base64sha256

  environment {
    variables = {
      DYNAMODB_TABLE           = aws_dynamodb_table.system_state.name
      FULL_SERVICE_LAMBDA      = aws_lambda_function.full_service.function_name
      DEGRADED_SERVICE_LAMBDA  = aws_lambda_function.degraded_service.function_name
      MINIMAL_SERVICE_LAMBDA   = aws_lambda_function.minimal_service.function_name
    }
  }

  depends_on = [
    aws_iam_role_policy_attachment.lambda_basic_execution,
    aws_cloudwatch_log_group.orchestrator_logs,
  ]

  tags = {
    Name        = "${var.project_name}-orchestrator"
    Environment = var.environment
    Project     = var.project_name
  }
}

# Full Service Lambda Function
resource "aws_lambda_function" "full_service" {
  filename         = data.archive_file.lambda_multi_zip.output_path
  function_name    = "${var.project_name}-full-service"
  role            = aws_iam_role.lambda_role.arn
  handler         = "full-service.handler"
  runtime         = "nodejs18.x"
  timeout         = 30
  memory_size     = 256

  source_code_hash = data.archive_file.lambda_multi_zip.output_base64sha256

  depends_on = [
    aws_iam_role_policy_attachment.lambda_basic_execution,
    aws_cloudwatch_log_group.full_service_logs,
  ]

  tags = {
    Name        = "${var.project_name}-full-service"
    Environment = var.environment
    Project     = var.project_name
  }
}

# Degraded Service Lambda Function
resource "aws_lambda_function" "degraded_service" {
  filename         = data.archive_file.lambda_multi_zip.output_path
  function_name    = "${var.project_name}-degraded-service"
  role            = aws_iam_role.lambda_role.arn
  handler         = "degraded-service.handler"
  runtime         = "nodejs18.x"
  timeout         = 30
  memory_size     = 256

  source_code_hash = data.archive_file.lambda_multi_zip.output_base64sha256

  depends_on = [
    aws_iam_role_policy_attachment.lambda_basic_execution,
    aws_cloudwatch_log_group.degraded_service_logs,
  ]

  tags = {
    Name        = "${var.project_name}-degraded-service"
    Environment = var.environment
    Project     = var.project_name
  }
}

# Minimal Service Lambda Function
resource "aws_lambda_function" "minimal_service" {
  filename         = data.archive_file.lambda_multi_zip.output_path
  function_name    = "${var.project_name}-minimal-service"
  role            = aws_iam_role.lambda_role.arn
  handler         = "minimal-service.handler"
  runtime         = "nodejs18.x"
  timeout         = 30
  memory_size     = 256

  source_code_hash = data.archive_file.lambda_multi_zip.output_base64sha256

  depends_on = [
    aws_iam_role_policy_attachment.lambda_basic_execution,
    aws_cloudwatch_log_group.minimal_service_logs,
  ]

  tags = {
    Name        = "${var.project_name}-minimal-service"
    Environment = var.environment
    Project     = var.project_name
  }
}

# CloudWatch Log Groups
resource "aws_cloudwatch_log_group" "orchestrator_logs" {
  name              = "/aws/lambda/${var.project_name}-orchestrator"
  retention_in_days = 14

  tags = {
    Name        = "${var.project_name}-orchestrator-logs"
    Environment = var.environment
    Project     = var.project_name
  }
}

resource "aws_cloudwatch_log_group" "full_service_logs" {
  name              = "/aws/lambda/${var.project_name}-full-service"
  retention_in_days = 14

  tags = {
    Name        = "${var.project_name}-full-service-logs"
    Environment = var.environment
    Project     = var.project_name
  }
}

resource "aws_cloudwatch_log_group" "degraded_service_logs" {
  name              = "/aws/lambda/${var.project_name}-degraded-service"
  retention_in_days = 14

  tags = {
    Name        = "${var.project_name}-degraded-service-logs"
    Environment = var.environment
    Project     = var.project_name
  }
}

resource "aws_cloudwatch_log_group" "minimal_service_logs" {
  name              = "/aws/lambda/${var.project_name}-minimal-service"
  retention_in_days = 14

  tags = {
    Name        = "${var.project_name}-minimal-service-logs"
    Environment = var.environment
    Project     = var.project_name
  }
}

resource "aws_cloudwatch_log_group" "api_gateway_logs" {
  name              = "/aws/apigateway/${var.project_name}"
  retention_in_days = 14

  tags = {
    Name        = "${var.project_name}-api-gateway-logs"
    Environment = var.environment
    Project     = var.project_name
  }
}

# API Gateway
resource "aws_apigatewayv2_api" "main" {
  name          = "${var.project_name}-api"
  protocol_type = "HTTP"

  cors_configuration {
    allow_credentials = false
    allow_headers     = ["Content-Type", "X-Amz-Date", "Authorization", "X-Api-Key", "X-Amz-Security-Token"]
    allow_methods     = ["GET", "POST", "OPTIONS"]
    allow_origins     = ["*"]
    max_age           = 86400
  }

  tags = {
    Name        = "${var.project_name}-api"
    Environment = var.environment
    Project     = var.project_name
  }
}

# API Gateway Stage
resource "aws_apigatewayv2_stage" "main" {
  api_id      = aws_apigatewayv2_api.main.id
  name        = var.environment
  auto_deploy = true

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api_gateway_logs.arn
    format = jsonencode({
      requestId      = "$context.requestId"
      ip             = "$context.identity.sourceIp"
      requestTime    = "$context.requestTime"
      httpMethod     = "$context.httpMethod"
      routeKey       = "$context.routeKey"
      status         = "$context.status"
      protocol       = "$context.protocol"
      responseLength = "$context.responseLength"
    })
  }

  tags = {
    Name        = "${var.project_name}-api-stage"
    Environment = var.environment
    Project     = var.project_name
  }
}

# API Gateway Integration (only with Orchestrator)
resource "aws_apigatewayv2_integration" "lambda" {
  api_id = aws_apigatewayv2_api.main.id

  integration_uri    = aws_lambda_function.orchestrator.invoke_arn
  integration_type   = "AWS_PROXY"
  integration_method = "POST"
}

# API Gateway Route
resource "aws_apigatewayv2_route" "post" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "POST /service-api"

  target = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

# Lambda permission for API Gateway (only Orchestrator needs it)
resource "aws_lambda_permission" "api_gateway" {
  statement_id  = "AllowExecutionFromAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.orchestrator.function_name
  principal     = "apigateway.amazonaws.com"

  source_arn = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
}

# Outputs
output "api_gateway_url" {
  description = "URL of the API Gateway"
  value       = "${aws_apigatewayv2_api.main.api_endpoint}/${var.environment}/service-api"
}

output "dynamodb_table_name" {
  description = "Name of the DynamoDB table"
  value       = aws_dynamodb_table.system_state.name
}

output "orchestrator_function_name" {
  description = "Name of the Orchestrator Lambda function"
  value       = aws_lambda_function.orchestrator.function_name
}

output "full_service_function_name" {
  description = "Name of the Full Service Lambda function"
  value       = aws_lambda_function.full_service.function_name
}

output "degraded_service_function_name" {
  description = "Name of the Degraded Service Lambda function"
  value       = aws_lambda_function.degraded_service.function_name
}

output "minimal_service_function_name" {
  description = "Name of the Minimal Service Lambda function"
  value       = aws_lambda_function.minimal_service.function_name
}
