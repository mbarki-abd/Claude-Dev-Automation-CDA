# Claude Authentication Traffic Capture - Instructions

## Setup Complete ✓

I've set up an HTTP/HTTPS proxy to capture the exact OAuth flow that Claude Code uses during authentication.

## Files Created

1. **[capture-claude-auth.cjs](capture-claude-auth.cjs)** - HTTP proxy server that captures all traffic
2. **[run-claude-with-proxy.ps1](run-claude-with-proxy.ps1)** - PowerShell script to run `claude` with proxy settings

## How to Capture the Auth Flow

### Step 1: Start the Proxy (ALREADY RUNNING)

The proxy is currently running in the background on port 8888. You can see it's active.

### Step 2: Run Claude Through the Proxy

Open a **NEW PowerShell window** and run:

```powershell
cd "c:\Users\mbark\ILINQSOFT\MCP-Projects - Documents\VScode\Claude-Dev-Automation-CDA"
.\run-claude-with-proxy.ps1
```

This will:
- Set proxy environment variables
- Launch `claude` interactive CLI
- All HTTP/HTTPS traffic will be captured

### Step 3: Complete Authentication

When `claude` starts:
1. It will show a menu - select the login option
2. It will generate an OAuth URL and open your browser
3. Log in to Claude.ai in the browser
4. Authorize the application
5. The browser will redirect with an authorization code
6. Claude CLI will exchange the code for tokens
7. **ALL of this traffic is being captured!**

### Step 4: Check Captured Data

After authentication completes, check:

```powershell
Get-Content "captured-requests.json"
```

This file contains:
- Every HTTP request URL, headers, and body
- Every HTTP response status, headers, and body
- OAuth authorization URLs
- Token exchange requests
- Access token responses

## What We'll Learn

The captured data will show us:

1. **OAuth Authorization URL**:
   - Exact endpoint
   - Client ID
   - Redirect URI
   - Scopes requested
   - State parameter

2. **Token Exchange Request**:
   - Endpoint URL (likely `https://claude.ai/oauth/token`)
   - Request method (POST)
   - Request body format
   - Required headers

3. **Token Response**:
   - Access token format
   - Refresh token format
   - Expiration time
   - Token type
   - Scopes granted

4. **Credentials Storage**:
   - How tokens are saved to `~/.claude/.credentials.json`
   - Token structure

## Next Steps

After capturing the traffic:

### 1. Analyze the Captured Requests

```javascript
// Example analysis script
const fs = require('fs');
const captured = JSON.parse(fs.readFileSync('captured-requests.json'));

// Find OAuth authorization request
const authRequest = captured.find(r =>
  r.request.url.includes('/oauth/authorize')
);

// Find token exchange request
const tokenRequest = captured.find(r =>
  r.request.url.includes('/oauth/token')
);

console.log('Authorization URL:', authRequest.request.url);
console.log('Token Exchange:', {
  url: tokenRequest.request.url,
  method: tokenRequest.request.method,
  body: JSON.parse(tokenRequest.request.body),
  response: JSON.parse(tokenRequest.response.body)
});
```

### 2. Implement Exact Flow

Using the captured data, we'll update `CLIAuthService.ts` to use the exact:
- OAuth URLs
- Request parameters
- Headers
- Token exchange format

### 3. Test Implementation

Test the updated service locally, then deploy to production.

## Current Status

- ✅ Proxy server running on port 8888
- ✅ PowerShell script ready to run `claude` with proxy
- ⏳ Waiting for you to run authentication and capture traffic
- ⏳ Analyze captured requests
- ⏳ Implement exact OAuth flow

## Troubleshooting

### Proxy not capturing HTTPS?
- Make sure `NODE_TLS_REJECT_UNAUTHORIZED=0` is set
- The proxy handles CONNECT tunneling for HTTPS

### Claude not using proxy?
- Verify environment variables are set in the same PowerShell session
- Check that `claude` command respects HTTP_PROXY environment variable

### Need to stop the proxy?
- It's running in background bash ID: 99e76c
- Check status with BashOutput tool
- Kill with KillShell tool

## Example Captured Data

Here's what we expect to see:

```json
[
  {
    "request": {
      "timestamp": "2025-11-25T19:00:00.000Z",
      "method": "GET",
      "url": "https://claude.ai/oauth/authorize?client_id=claude_code&redirect_uri=...",
      "headers": {...}
    },
    "response": {
      "statusCode": 302,
      "headers": {
        "location": "https://claude.ai/login?..."
      }
    }
  },
  {
    "request": {
      "timestamp": "2025-11-25T19:01:30.000Z",
      "method": "POST",
      "url": "https://claude.ai/oauth/token",
      "body": "{\"grant_type\":\"authorization_code\",\"code\":\"...\",\"redirect_uri\":\"...\",\"client_id\":\"claude_code\"}"
    },
    "response": {
      "statusCode": 200,
      "body": "{\"access_token\":\"sk-ant-oat01-...\",\"refresh_token\":\"sk-ant-ort01-...\",\"expires_in\":2592000}"
    }
  }
]
```

## Ready to Proceed

**ACTION REQUIRED**:

Please open a new PowerShell window and run:

```powershell
cd "c:\Users\mbark\ILINQSOFT\MCP-Projects - Documents\VScode\Claude-Dev-Automation-CDA"
.\run-claude-with-proxy.ps1
```

Then complete the authentication flow. Once done, we'll have the exact OAuth implementation details!
