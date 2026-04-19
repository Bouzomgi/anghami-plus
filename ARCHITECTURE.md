# Anghami Plus — Architecture

## Request Flow

```
Chrome Extension (background.js)
    │  SigV4-signed POST  { action, lyrics }
    ▼
Lambda Function URL  (AuthType: AWS_IAM)   ← not publicly accessible
    ├──▶ Bedrock  anthropic.claude-3-5-sonnet-20241022-v2:0
    └──▶ S3  anghami-plus-cache  (Feature 4)
```

## IAM Design

**Extension-side IAM user** — only permission:
```json
{
  "Effect": "Allow",
  "Action": "lambda:InvokeFunctionUrl",
  "Resource": "arn:aws:lambda:REGION:ACCOUNT_ID:function:anghami-plus-proxy"
}
```
Credentials are entered once in the options page → `chrome.storage.sync`. Keep the secret in iCloud Passwords; paste into options on each device.

**Lambda execution role:**
```json
[
  { "Action": "bedrock:InvokeModel",         "Resource": "arn:aws:bedrock:REGION::foundation-model/anthropic.claude-3-5-sonnet-20241022-v2:0" },
  { "Action": ["s3:GetObject","s3:PutObject"], "Resource": "arn:aws:s3:::anghami-plus-cache/*" }
]
```

## Lambda API

| Field | Value |
|---|---|
| Method | POST |
| Auth | AWS_IAM (SigV4) |
| Request | `{ "action": "translate" \| "harakat", "lyrics": "..." }` |
| Response | `{ "result": "..." }` or `{ "error": "..." }` |

## Why This Approach

Lambda Function URL with IAM auth was chosen over:
- **Direct IAM credentials to Bedrock/S3** — stolen key = full resource access
- **Cognito unauthenticated pool** — anyone with the Pool ID gets credentials
- **API Gateway + OAuth** — correct but overkill for a single personal user
