# Nexmo PSTN Load Test

Load test tool for Chime PSTN dial-in using Vonage (Nexmo) to place calls.

## Prerequisites

- Node.js
- Vonage account with Voice API enabled
- Vonage Application with private key
- Virtual phone number(s) in Vonage dashboard

## Setup

### 1. Configure Vonage credentials

```bash
cp scripts/nexmo-config.template.sh scripts/nexmo-config.sh
```

Edit `nexmo-config.sh` with your Vonage account details:
- API key/secret from dashboard
- Application ID
- Path to private key file
- Virtual phone number (E.164 format)

For higher call rates, add multiple accounts to `NEXMO_ACCOUNTS_JSON` (Vonage limits ~3 calls/sec per account).

### 2. Configure meetings

```bash
cp scripts/meetings-config.template.json scripts/meetings-config.json
```

Add your meetings with empty analysts array:
```json
{
  "environment": "dev",
  "baseUrl": "https://attendees.dev.events.q4inc.com",
  "meetings": [
    {
      "meetingId": "123456789",
      "analystRegistrationPassword": "yourPassword",
      "desiredAnalystCount": 10,
      "analysts": []
    }
  ]
}
```

### 3. Register analysts

Run the registration script to create analysts and get their PINs:
```bash
node scripts/ep-analyst-registration.js
```

This generates fake analyst data, registers them via API, and saves PINs back to `meetings-config.json`.

Options:
- `--dry-run` - simulate without making API calls
- `--force` - re-register even if analysts exist

### 4. Set the target PSTN number

In `nexmo-config.sh`, set the Chime dial-in number:
```bash
export CHIME_PSTN_NUMBER="+18005551234"
```

## Running the test

```bash
cd ep-load-test
source scripts/nexmo-config.sh
node scripts/nexmo-pstn-load-test.js
```

### Options

| Flag | Env Var | Default | Description |
|------|---------|---------|-------------|
| `--target-concurrent` | `TARGET_CONCURRENT` | 1 | Max concurrent calls |
| `--arrival-rate` | `ARRIVAL_RATE` | 5 | Calls per second |
| `--call-duration` | `CALL_DURATION_SECONDS` | 120 | Call length (seconds) |
| `--test-duration` | `TEST_DURATION` | 60 | Test length (seconds) |
| `--dry-run` | - | false | Simulate without calling |

Example:
```bash
node scripts/nexmo-pstn-load-test.js --target-concurrent 50 --arrival-rate 3 --test-duration 300
```

## IVR timing

Adjust these if calls fail to navigate the IVR:

| Env Var | Default | Description |
|---------|---------|-------------|
| `IVR_GREETING_DELAY_MS` | 2000 | Wait before entering meeting ID |
| `IVR_MEETING_ID_DELAY_MS` | 10000 | Wait before entering PIN |
| `IVR_JITTER_MS` | 1000 | Random delay spread |

## Webhook mode (optional)

For more reliable IVR navigation under load, enable webhook mode:

1. Start ngrok: `ngrok http 3000`
2. Set in config:
   ```bash
   export WEBHOOK_ENABLED="true"
   export WEBHOOK_BASE_URL="https://your-ngrok-url.ngrok.io"
   ```

## Stopping

Press `Ctrl+C` for graceful shutdown - active calls will be hung up cleanly.

