# Chime load-test SIP Media Application (Terraform)

Provisions a **dedicated test** SIP Media Application (`aws_chimesdkvoice_sip_media_application`) and a Node.js Lambda for **Dynamo-gated** load-test dial-out: outbound **`CALL_ANSWERED`** returns empty `Actions`; **`CALL_UPDATE_REQUESTED`** returns **`SendDigits`** from `Arguments.loadTestDigits` (after `ep-load-test` calls `UpdateSipMediaApplicationCall`). Use this SMA ID as `LOAD_TEST_SMA_ID` — **never** point production traffic here.

This stack is intentionally smaller than the `chime-sma` Terraform in the **events-streaming** repository: no SIP hostname rule, no SSM parameters, and no SMA message logging bootstrap.

## Prerequisites

- Terraform `>= 1.5`
- AWS credentials with permissions to create IAM roles, Lambda, and Chime SDK Voice SMA resources in the target account/region
- Lambda CloudWatch log group is Terraform-managed via `aws_cloudwatch_log_group.sma_handler` (retention from `lambda_log_retention_days`, default `14`)

## Apply

```bash
cd .deploy/chime-load-test-sma
cp backend.hcl.example backend.hcl             # set bucket/key/region/table
terraform init -reconfigure -backend-config=backend.hcl
cp terraform.tfvars.example terraform.tfvars   # optional
terraform plan
terraform apply
```

## Outputs

After apply:

```bash
terraform output -raw sip_media_application_id
```

Set for dial-out:

```bash
export LOAD_TEST_SMA_ID="$(terraform output -raw sip_media_application_id)"
```

Use with `LOAD_TEST_FROM_PHONE`, `LOAD_TEST_TO_PHONE`, **`DIALOUT_PARTICIPANTS_TABLE_NAME`**, and optional `PRODUCTION_SMA_ID` as documented in `ep-load-test/README.md`.

## Lambda behaviour

Matches the outbound flow in [Making an outbound call…](https://docs.aws.amazon.com/chime-sdk/latest/dg/use-create-call-api.html):

- **`NEW_OUTBOUND_CALL` / `RINGING`**: return empty `Actions` (Chime ignores the response for these invocations).
- **`CALL_ANSWERED`** with **`Direction` = `Outbound`**: return **empty** `Actions` (worker polls Dynamo, then `UpdateSipMediaApplicationCall`).
- **`CALL_UPDATE_REQUESTED`**: outbound leg with `Arguments.loadTestHangup` = `true` → return **`Hangup`** (load-test teardown). Otherwise `Arguments.loadTestDigits` → **`SendDigits`**. See [Updating in-progress calls](https://docs.aws.amazon.com/chime-sdk/latest/dg/update-sip-call.html).
- **`ACTION_SUCCESSFUL`** after outbound **`SendDigits`**: return **empty** `Actions`.

Optional **inbound** path if PSTN is routed into the same SMA:

- **`NEW_INBOUND_CALL`**: `Answer`.
- **`ACTION_SUCCESSFUL`** after `Answer`: `Hangup`.

- **`ACTION_FAILED`** (outbound): log and **`Hangup`**.

Logs one JSON line per invocation (`InvocationEventType`, `Direction`, `meetingId` / `attendeeId` when present); **PIN values are redacted** in logs.

Terraform zips `lambda_src/index.js` only.

## Lambda logging (CloudWatch)

Lambda handler logs (`console.log`) are written to CloudWatch Logs log group:

- `/aws/lambda/<lambda function name>`
- Managed by Terraform resource `aws_cloudwatch_log_group.sma_handler`
- Retention controlled by `lambda_log_retention_days` (default `14`)

Example override:

```hcl
lambda_log_retention_days = 30
```

## State

This module is configured for an S3 backend via `backend "s3" {}` in Terraform.
Provide concrete backend settings via CLI init config (recommended):

```bash
terraform init -reconfigure -backend-config=backend.hcl
```

Use `backend.hcl.example` as a template (the local `backend.hcl` file is gitignored).

## Destroy

Run destroy with the same backend config so Terraform uses the remote state:

```bash
terraform init -reconfigure -backend-config=backend.hcl
terraform destroy
```
