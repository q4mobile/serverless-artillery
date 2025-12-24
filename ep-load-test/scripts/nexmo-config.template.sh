#!/bin/bash
# Nexmo (Vonage) PSTN Load Test Configuration
# Copy this file to nexmo-config.sh and fill in your values
# Then source it before running tests: source scripts/nexmo-config.sh

# ============================================================================
# Nexmo/Vonage Account Configuration
# Get credentials from: https://dashboard.nexmo.com/
# ============================================================================
# Configure one or more Vonage accounts as a JSON array.
# Vonage rate limits are typically 3 calls/sec per account.
# For higher rates, add more accounts (e.g., 8 accounts = 24 calls/sec).
#
# Required fields per account:
#   - name: Friendly name for logging
#   - apiKey: API key from dashboard
#   - apiSecret: API secret from dashboard  
#   - applicationId: Voice Application ID
#   - privateKeyPath: Path to private key file
#   - fromNumber: Your Nexmo virtual number (E.164 format)

export NEXMO_ACCOUNTS_JSON='[
  {
    "name": "Account 1",
    "apiKey": "your_api_key",
    "apiSecret": "your_api_secret",
    "applicationId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    "privateKeyPath": "./scripts/private.key",
    "fromNumber": "+1XXXXXXXXXX"
  }
]'

# ============================================================================
# Amazon Chime PSTN Configuration
# ============================================================================

# The Chime PSTN number to dial into
# This is the number associated with your SIP Media Application
# Format: E.164 with + prefix (e.g., +18005551234)
export CHIME_PSTN_NUMBER="+1XXXXXXXXXX"

# ============================================================================
# IVR Navigation Configuration
# Meeting IDs and PINs are loaded from meetings-config.json
# ============================================================================

# Delay (ms) after call connects before entering meeting ID
# Adjust based on your IVR greeting length (e.g., "Welcome to...")
# Default: 2000 (2 seconds)
export IVR_GREETING_DELAY_MS="2000"

# Delay (ms) after entering meeting ID before entering PIN
# Adjust based on how long the IVR takes to validate and prompt
# Default: 10000 (10 seconds)
export IVR_MEETING_ID_DELAY_MS="10000"

# Random jitter (ms) added to delays to spread out DTMF timing
# Helps prevent thundering herd issues under high load
# Default: 2000 (2 seconds)
export IVR_JITTER_MS="2000"

# ============================================================================
# Webhook Configuration (Optional - for event-driven IVR navigation)
# When enabled, IVR navigation is triggered by call answer events
# instead of fixed timers. More reliable under high load.
# ============================================================================

# Enable webhook mode (true/false)
# When enabled, start ngrok or use a public URL before running tests
export WEBHOOK_ENABLED="false"

# Port for the webhook server to listen on
# Default: 3000
export WEBHOOK_PORT="3000"

# Public URL where Vonage can send webhook events
# Use ngrok for local testing: ngrok http 3000 → https://xxx.ngrok.io
# Must be publicly accessible for Vonage to reach
export WEBHOOK_BASE_URL=""

# Debug mode for webhooks (logs all events)
export DEBUG_WEBHOOKS="false"

# ============================================================================
# Test Configuration
# ============================================================================

# How long each test call should stay connected (in seconds)
# Longer = more concurrent calls at steady state
# Shorter = more calls cycled through during test
export CALL_DURATION_SECONDS="120"

# ============================================================================
# Test Settings
# ============================================================================
export TARGET_CONCURRENT="1"
export ARRIVAL_RATE="3"
export TEST_DURATION="60"

echo "✅ Nexmo environment variables loaded"
echo "   CHIME_PSTN_NUMBER: $CHIME_PSTN_NUMBER"
echo "   TARGET_CONCURRENT: $TARGET_CONCURRENT"
