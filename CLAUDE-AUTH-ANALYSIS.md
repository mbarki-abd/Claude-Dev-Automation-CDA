# Claude Code Authentication Analysis

## Problem Statement

The current CLI authentication implementation has a critical issue: after the user authorizes the OAuth request in their browser and receives a code, **the code cannot be properly submitted back to the Claude CLI process's stdin**.

## Authentication Flow Discovery

### 1. Where Claude Stores Credentials

**Location**: `~/.claude/.credentials.json`

**Structure**:
```json
{
  "claudeAiOauth": {
    "accessToken": "sk-ant-oat01-...",
    "refreshToken": "sk-ant-ort01-...",
    "expiresAt": 1764125735552,
    "scopes": [
      "user:inference",
      "user:profile",
      "user:sessions:claude_code"
    ],
    "subscriptionType": "max",
    "rateLimitTier": "default_claude_max_20x"
  }
}
```

### 2. Claude Code OAuth Flow

Based on analysis of the credentials file and OAuth patterns, the flow is:

```
1. Application generates OAuth URL:
   https://claude.ai/oauth/authorize?
     client_id=claude_code
     &redirect_uri=http://localhost:8080/oauth/callback
     &response_type=code
     &scope=user:inference user:profile user:sessions:claude_code
     &state=<random>

2. User opens URL in browser → Logs in → Authorizes

3. Browser redirects to callback URL with authorization code:
   http://localhost:8080/oauth/callback?code=<auth_code>&state=<state>

4. Application extracts code from callback

5. Application exchanges code for tokens:
   POST https://claude.ai/oauth/token
   {
     "grant_type": "authorization_code",
     "code": "<auth_code>",
     "redirect_uri": "http://localhost:8080/oauth/callback",
     "client_id": "claude_code"
   }

6. Response contains:
   {
     "access_token": "sk-ant-oat01-...",
     "refresh_token": "sk-ant-ort01-...",
     "expires_in": 2592000,  // 30 days
     "token_type": "Bearer",
     "scope": "user:inference user:profile user:sessions:claude_code"
   }

7. Write tokens to ~/.claude/.credentials.json
```

## Current Implementation Issues

### Problem 1: Interactive Process Automation
The current `CLIAuthService.ts` spawns the `claude` command and tries to:
- Capture stdout to extract the OAuth URL
- Navigate through interactive menus by writing to stdin
- Submit the authorization code back through stdin

**Why this fails**:
- The `claude` CLI process runs in an isolated environment
- stdin/stdout buffering and timing issues
- The process expects TTY interaction, not programmatic input
- Complex state machine with menu navigation

### Problem 2: Code Submission Blockage
```typescript
// Line 227 in CLIAuthService.ts
session.sshStream.write(code.trim() + '\n');
```

This assumes:
- The Claude process is still running and waiting for input
- The process is in the correct state to accept the code
- The input stream is properly buffered and will reach the process

**Reality**: These assumptions often don't hold, especially in server environments.

## Solutions

### Solution 1: Direct OAuth Implementation (RECOMMENDED)

Instead of spawning `claude` command, implement the OAuth flow directly:

**Advantages**:
✅ No dependency on CLI being installed
✅ Full control over the flow
✅ Works reliably in server environments
✅ Can handle errors gracefully
✅ Better security (can validate redirect)

**Implementation**: See `CLIAuthServiceV2.ts`

**Flow**:
1. Generate OAuth URL → Send to frontend
2. Frontend opens OAuth URL in new window
3. User authorizes → Browser redirects to callback
4. Frontend captures auth code from callback URL
5. Frontend sends code to backend API
6. Backend exchanges code for access token via HTTP
7. Backend writes credentials to `~/.claude/.credentials.json`

### Solution 2: Expect/PTY-based Automation

Use `node-pty` or similar to create a pseudo-terminal:

```typescript
import * as pty from 'node-pty';

const ptyProcess = pty.spawn('claude', [], {
  name: 'xterm-color',
  cols: 80,
  rows: 30,
  cwd: workspaceDir,
  env: process.env
});

ptyProcess.onData((data) => {
  // Handle output, detect prompts
});

ptyProcess.write(authCode + '\r');
```

**Advantages**:
✅ More reliable than plain spawn
✅ Proper TTY emulation

**Disadvantages**:
❌ Requires native compilation (node-gyp)
❌ Still dependent on CLI behavior
❌ Complex state management

### Solution 3: Hybrid Approach

Combine both approaches:

1. Use direct OAuth for initial authentication
2. Use credentials file for subsequent API calls
3. Implement automatic token refresh

## Recommended Implementation

### Step 1: Implement OAuth Token Exchange

```typescript
async function exchangeCodeForToken(authCode: string): Promise<ClaudeTokens> {
  const response = await fetch('https://claude.ai/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code: authCode,
      redirect_uri: 'http://localhost:8080/oauth/callback',
      client_id: 'claude_code'
    })
  });

  if (!response.ok) {
    throw new Error(`OAuth token exchange failed: ${response.statusText}`);
  }

  const data = await response.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (data.expires_in * 1000),
    scopes: data.scope.split(' ')
  };
}
```

### Step 2: Write Credentials

```typescript
async function saveClaudeCredentials(tokens: ClaudeTokens): Promise<void> {
  const credentialsPath = path.join(os.homedir(), '.claude', '.credentials.json');
  const credentials = {
    claudeAiOauth: {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      scopes: tokens.scopes,
      subscriptionType: 'max', // From user profile
      rateLimitTier: 'default_claude_max_20x'
    }
  };

  await fs.mkdir(path.dirname(credentialsPath), { recursive: true });
  await fs.writeFile(credentialsPath, JSON.stringify(credentials), 'utf-8');
}
```

### Step 3: Add OAuth Callback Server

```typescript
import { createServer } from 'http';

function startOAuthCallbackServer(sessionId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url!, 'http://localhost:8080');

      if (url.pathname === '/oauth/callback') {
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');

        if (code) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<html><body><h1>Authentication Successful!</h1><p>You can close this window.</p></body></html>');

          server.close();
          resolve(code);
        } else {
          res.writeHead(400);
          res.end('No code received');
          server.close();
          reject(new Error('No authorization code received'));
        }
      }
    });

    server.listen(8080, () => {
      logger.info('OAuth callback server listening on port 8080');
    });

    // Timeout after 10 minutes
    setTimeout(() => {
      server.close();
      reject(new Error('OAuth callback timeout'));
    }, 10 * 60 * 1000);
  });
}
```

## Testing the Implementation

### Local Testing
```bash
# 1. Start the API
pnpm dev:api

# 2. Call the auth endpoint
curl -X POST http://localhost:3000/api/cli-auth/claude-code/start

# 3. Open the returned authUrl in browser

# 4. After authorization, submit the code
curl -X POST http://localhost:3000/api/cli-auth/sessions/<sessionId>/submit-code \
  -H "Content-Type: application/json" \
  -d '{"code":"<authorization_code>"}'

# 5. Verify credentials file
cat ~/.claude/.credentials.json
```

### Production Testing
```bash
# SSH into production server
ssh root@78.47.138.194

# Create .claude directory
mkdir -p /root/.claude

# Test the auth flow
curl -X POST http://localhost:3000/api/cli-auth/claude-code/start

# After completion, verify
cat /root/.claude/.credentials.json
```

## Security Considerations

1. **Credentials Storage**: `.credentials.json` contains sensitive tokens
   - Should have 600 permissions (read/write for owner only)
   - Not committed to git

2. **OAuth State Parameter**: Should be validated to prevent CSRF

3. **Redirect URI**: Should be validated to prevent authorization code interception

4. **Token Refresh**: Implement automatic token refresh before expiration

## Next Steps

1. ✅ Understand where Claude stores credentials
2. ✅ Analyze OAuth flow
3. ⏳ Implement direct OAuth token exchange
4. ⏳ Add OAuth callback server
5. ⏳ Test end-to-end flow locally
6. ⏳ Deploy to production
7. ⏳ Test on production server

## References

- Claude Code credentials location: `~/.claude/.credentials.json`
- OAuth 2.0 Authorization Code Flow: https://oauth.net/2/grant-types/authorization-code/
- Token structure: Access token (oat01) + Refresh token (ort01)
