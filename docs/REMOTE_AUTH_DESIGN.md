# Claude Remote Authentication Design

## Overview

This document describes the architecture for remote Claude CLI authentication in the CDA (Claude Dev Automation) platform. The system allows users to authenticate Claude CLI on a remote server using credentials from their local machine, eliminating the need for interactive browser-based OAuth on headless servers.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CDA Platform                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────────────┐    ┌──────────────────────┐    ┌────────────────┐ │
│  │   Dashboard (React)   │◄──►│    API (Fastify)     │◄──►│  PostgreSQL    │ │
│  │                        │    │                      │    │                │ │
│  │  • Auth Status UI      │    │  • RemoteAuthService │    │  • Credentials │ │
│  │  • Credential Sync     │    │  • CLIAuthServiceV2  │    │  • Sessions    │ │
│  │  • Token Monitor       │    │  • AutoAuthService   │    │  • Settings    │ │
│  └──────────────────────┘    └──────────────────────┘    └────────────────┘ │
│            │                           │                                     │
│            │ WebSocket                 │ SSH/SCP                            │
│            ▼                           ▼                                     │
│  ┌──────────────────────┐    ┌──────────────────────┐                       │
│  │  Browser Extension    │    │   Remote Server      │                       │
│  │  (Optional OAuth)     │    │   (Hetzner/Docker)   │                       │
│  │                        │    │                      │                       │
│  │  • OAuth Flow         │    │  • ~/.claude/        │                       │
│  │  • Token Exchange     │    │    .credentials.json │                       │
│  │  • Code Capture       │    │  • Claude CLI        │                       │
│  └──────────────────────┘    └──────────────────────┘                       │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Authentication Methods

### Method 1: Credential Transfer (Recommended)
Transfer existing credentials from local machine to remote server.

**Flow:**
1. User authenticates Claude CLI locally (standard browser OAuth)
2. Local credentials stored at `~/.claude/.credentials.json`
3. CDA reads local credentials via API
4. CDA transfers credentials to remote server via SSH/SCP
5. Remote Claude CLI uses transferred credentials

**Credentials Format:**
```json
{
  "claudeAiOauth": {
    "accessToken": "sk-ant-oat01-...",
    "refreshToken": "sk-ant-ort01-...",
    "expiresAt": 1764203807818,
    "scopes": ["user:inference", "user:profile", "user:sessions:claude_code"],
    "subscriptionType": "max",
    "rateLimitTier": "default_claude_max_20x"
  }
}
```

### Method 2: Direct OAuth with Chrome Extension
Use browser extension to capture OAuth tokens directly.

**Flow:**
1. Server generates PKCE code challenge/verifier
2. Extension opens OAuth URL in browser
3. User authorizes in Anthropic console
4. Extension captures auth code and exchanges for tokens
5. Tokens sent to server via WebSocket
6. Server writes credentials file

### Method 3: API Key Bypass
Use ANTHROPIC_API_KEY environment variable instead of OAuth.

**Flow:**
1. User provides API key from Anthropic Console
2. CDA creates API key helper script
3. Set environment variable ANTHROPIC_API_KEY
4. Claude CLI uses API key directly

## Service Architecture

### RemoteAuthService
Primary service for remote credential management.

```typescript
interface RemoteAuthService {
  // Credential Operations
  getLocalCredentials(): Promise<ClaudeCredentials | null>;
  transferCredentials(target: RemoteTarget): Promise<TransferResult>;
  verifyRemoteAuth(target: RemoteTarget): Promise<AuthStatus>;

  // OAuth Flow (via Extension)
  startOAuthFlow(): Promise<OAuthSession>;
  handleOAuthCallback(tokens: TokenResponse): Promise<void>;

  // Token Management
  getTokenExpiry(): Promise<ExpiryInfo>;
  refreshToken(): Promise<RefreshResult>;

  // Sync Operations
  syncCredentials(source: 'local' | 'remote'): Promise<SyncResult>;
}
```

### Data Types

```typescript
interface RemoteTarget {
  type: 'ssh' | 'docker' | 'local';
  host?: string;
  port?: number;
  user?: string;
  privateKey?: string;
  containerId?: string;
}

interface ClaudeCredentials {
  claudeAiOauth: {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    scopes: string[];
    subscriptionType?: string;
    rateLimitTier?: string;
  };
}

interface TransferResult {
  success: boolean;
  method: 'scp' | 'docker-cp' | 'direct';
  target: string;
  credentialsPath: string;
  message: string;
}

interface AuthStatus {
  authenticated: boolean;
  status: 'active' | 'expiring_soon' | 'expired' | 'not_authenticated';
  expiresAt?: number;
  expiresIn?: string;
  subscription?: string;
  email?: string;
}
```

## API Endpoints

### Remote Authentication

```
# Get local credentials status
GET /api/cli-auth/local/status

# Get remote credentials status
GET /api/cli-auth/remote/status

# Transfer credentials to remote
POST /api/cli-auth/remote/transfer
Body: { target: RemoteTarget }

# Sync credentials (local ↔ remote)
POST /api/cli-auth/remote/sync
Body: { direction: 'to-remote' | 'from-remote' }

# Start OAuth flow (for extension)
POST /api/cli-auth/oauth/start
Response: { sessionId, authUrl, codeVerifier }

# Handle OAuth callback
POST /api/cli-auth/oauth/callback
Body: { sessionId, tokens }

# Verify Claude CLI works
POST /api/cli-auth/remote/verify
Body: { target: RemoteTarget }
```

## WebSocket Events

```typescript
// Server → Client
interface AuthEvents {
  'auth:status-changed': AuthStatus;
  'auth:transfer-progress': { progress: number; message: string };
  'auth:transfer-complete': TransferResult;
  'auth:token-expiring': { expiresIn: string };
  'auth:oauth-url': { url: string; sessionId: string };
  'auth:oauth-complete': { success: boolean; credentials?: Partial<ClaudeCredentials> };
}

// Client → Server
interface AuthCommands {
  'auth:request-status': void;
  'auth:start-transfer': RemoteTarget;
  'auth:start-oauth': void;
  'auth:submit-tokens': TokenResponse;
}
```

## Dashboard UI Components

### AuthStatusCard
Displays current authentication status with visual indicators.

```tsx
<AuthStatusCard>
  <StatusIndicator status="active" />
  <TokenInfo>
    <ExpiresIn>5h 23m</ExpiresIn>
    <Subscription>Claude Max</Subscription>
    <Email>user@example.com</Email>
  </TokenInfo>
  <Actions>
    <RefreshButton />
    <TransferButton />
    <LogoutButton />
  </Actions>
</AuthStatusCard>
```

### CredentialSyncPanel
Manage credential synchronization between local and remote.

```tsx
<CredentialSyncPanel>
  <LocalStatus credentials={localCreds} />
  <SyncDirection onSync={handleSync} />
  <RemoteStatus credentials={remoteCreds} />
  <TransferProgress progress={progress} />
</CredentialSyncPanel>
```

### TokenMonitor
Real-time token expiration monitoring.

```tsx
<TokenMonitor>
  <CountdownTimer expiresAt={expiresAt} />
  <AutoRefreshToggle enabled={autoRefresh} />
  <RefreshHistory entries={refreshLog} />
</TokenMonitor>
```

## Security Considerations

1. **Credential Storage**: Credentials are stored with 0600 permissions
2. **SSH Keys**: Private keys should be stored securely, not in code
3. **Token Refresh**: Auto-refresh before expiration to avoid interruption
4. **Audit Logging**: All credential operations are logged
5. **Session Timeout**: OAuth sessions expire after 10 minutes

## Implementation Priority

1. **Phase 1**: RemoteAuthService with credential transfer
2. **Phase 2**: Dashboard UI for status and sync
3. **Phase 3**: WebSocket real-time updates
4. **Phase 4**: Chrome extension OAuth flow
5. **Phase 5**: Auto-refresh and monitoring

## Configuration

```env
# Remote Authentication Settings
REMOTE_AUTH_ENABLED=true
REMOTE_SSH_HOST=cda.ilinqsoft.com
REMOTE_SSH_USER=root
REMOTE_SSH_KEY_PATH=/path/to/key
REMOTE_CREDENTIALS_PATH=/root/.claude/.credentials.json

# OAuth Settings
CLAUDE_OAUTH_CLIENT_ID=9d1c250a-e61b-44d9-88ed-5944d1962f5e
CLAUDE_OAUTH_REDIRECT_URI=https://console.anthropic.com/oauth/code/callback
CLAUDE_OAUTH_SCOPES=user:inference user:profile user:sessions:claude_code

# Token Management
TOKEN_AUTO_REFRESH=true
TOKEN_REFRESH_THRESHOLD=300000  # 5 minutes before expiry
```
