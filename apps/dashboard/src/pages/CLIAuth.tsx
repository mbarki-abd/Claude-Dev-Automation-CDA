import { useState, useEffect } from 'react';
import { CheckCircle, XCircle, Loader2, ExternalLink, Copy, Cloud, Terminal, Key, RefreshCw, Package, Download, Server, Zap, Chrome, Shield, Eye, EyeOff, Upload, ArrowRightLeft, Laptop, HardDrive } from 'lucide-react';

// Use empty string for relative URLs - nginx proxies /api to the backend
const API_URL = import.meta.env.VITE_API_URL || '';

interface AutoAuthStatus {
  authenticated: boolean;
  method?: string;
  expiresAt?: number;
}

interface AuthStatus {
  authenticated: boolean;
  details?: string;
}

interface ClaudeDetailedStatus {
  authenticated: boolean;
  status: 'active' | 'expiring_soon' | 'expired' | 'not_authenticated';
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  expiresIn?: string;
  scopes?: string[];
  userId?: string;
  email?: string;
  subscription?: string;
  rateLimitTier?: string;
  credentialsPath?: string;
}

interface RemoteAuthStatus {
  local: ClaudeDetailedStatus;
  remote: ClaudeDetailedStatus & { error?: string };
  synced: boolean;
}

interface TransferResult {
  success: boolean;
  method: string;
  target: string;
  credentialsPath: string;
  message: string;
  timestamp: number;
}

interface AuthSession {
  id: string;
  tool: 'claude-code' | 'gcloud' | 'azure-cli';
  status: 'pending' | 'waiting_for_code' | 'authenticating' | 'success' | 'failed';
  authUrl?: string;
  userCode?: string;
  message?: string;
  createdAt: string;
  expiresAt?: string;
}

interface ToolsStatus {
  host: string;
  tools: Record<string, { installed: boolean; version: string }>;
  checkedAt: string;
}

export function CLIAuth() {
  const [authStatus, setAuthStatus] = useState<Record<string, AuthStatus>>({});
  const [loading, setLoading] = useState(true);
  const [activeSession, setActiveSession] = useState<AuthSession | null>(null);
  const [startingAuth, setStartingAuth] = useState<string | null>(null);
  const [authCode, setAuthCode] = useState('');
  const [submittingCode, setSubmittingCode] = useState(false);
  const [output, setOutput] = useState<string[]>([]);
  const [toolsStatus, setToolsStatus] = useState<ToolsStatus | null>(null);
  const [toolsLoading, setToolsLoading] = useState(false);
  const [installingTool, setInstallingTool] = useState<string | null>(null);

  // Auto-Auth state
  const [autoAuthStatus, setAutoAuthStatus] = useState<AutoAuthStatus | null>(null);
  const [, setAutoAuthLoading] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [settingUpApiKey, setSettingUpApiKey] = useState(false);
  const [extensionConnected, setExtensionConnected] = useState(false);
  const [autoAuthMethod, setAutoAuthMethod] = useState<'extension' | 'api-key' | null>(null);

  // Remote Auth state
  const [remoteAuthStatus, setRemoteAuthStatus] = useState<RemoteAuthStatus | null>(null);
  const [remoteAuthLoading, setRemoteAuthLoading] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [transferResult, setTransferResult] = useState<TransferResult | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{ success: boolean; output: string } | null>(null);

  useEffect(() => {
    loadAuthStatus();
    loadToolsStatus();
    loadAutoAuthStatus();
    loadRemoteAuthStatus();
    checkExtensionConnection();
    // Poll for status updates
    const interval = setInterval(() => {
      loadAuthStatus();
      loadAutoAuthStatus();
      loadRemoteAuthStatus();
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (activeSession?.id) {
      // Poll for session updates
      const interval = setInterval(async () => {
        try {
          const res = await fetch(`${API_URL}/api/cli-auth/sessions/${activeSession.id}`);
          const data = await res.json();
          if (data.success && data.data) {
            setActiveSession(data.data);
            if (data.data.status === 'success' || data.data.status === 'failed') {
              loadAuthStatus();
            }
          }
        } catch (error) {
          console.error('Failed to poll session:', error);
        }
      }, 2000);
      return () => clearInterval(interval);
    }
  }, [activeSession?.id]);

  const loadAuthStatus = async () => {
    try {
      const res = await fetch(`${API_URL}/api/cli-auth/status`);
      const data = await res.json();
      if (data.success) {
        setAuthStatus(data.data);
      }
    } catch (error) {
      console.error('Failed to load auth status:', error);
    } finally {
      setLoading(false);
    }
  };

  const startAuth = async (tool: 'claude-code' | 'azure-cli' | 'gcloud') => {
    // For Claude Code, use OAuth flow instead of PTY-based auth
    if (tool === 'claude-code') {
      startClaudeOAuth();
      return;
    }

    setStartingAuth(tool);
    setOutput([]);
    setAuthCode('');
    try {
      const res = await fetch(`${API_URL}/api/cli-auth/${tool}/start`, { method: 'POST' });
      const data = await res.json();
      if (data.success && data.data) {
        setActiveSession(data.data);

        // For Azure CLI, automatically open the device login page
        if (tool === 'azure-cli' && data.data.authUrl) {
          window.open(data.data.authUrl, '_blank');
        }
        // For gcloud, auto-open the auth URL (user will need to copy auth code back)
        if (tool === 'gcloud' && data.data.authUrl) {
          window.open(data.data.authUrl, '_blank');
        }
      } else {
        alert(data.error?.message || 'Failed to start authentication');
      }
    } catch (error) {
      console.error('Failed to start auth:', error);
      alert('Failed to start authentication');
    } finally {
      setStartingAuth(null);
    }
  };

  const startClaudeOAuth = async () => {
    setStartingAuth('claude-code');
    setOutput([]);
    setAuthCode('');
    try {
      // Use the OAuth flow endpoint to get an auth URL
      const res = await fetch(`${API_URL}/api/cli-auth/oauth/start`, { method: 'POST' });
      const data = await res.json();
      if (data.success && data.data) {
        // Create a session-like object for the UI
        setActiveSession({
          id: data.data.sessionId,
          tool: 'claude-code',
          status: 'waiting_for_code',
          authUrl: data.data.authUrl,
          message: 'Open the URL in your browser, authorize the app, and the credentials will be saved automatically.',
          createdAt: new Date().toISOString(),
          expiresAt: new Date(data.data.expiresAt).toISOString()
        });
        // Open auth URL in new tab
        window.open(data.data.authUrl, '_blank');
      } else {
        alert(data.error?.message || 'Failed to start OAuth authentication');
      }
    } catch (error) {
      console.error('Failed to start OAuth:', error);
      alert('Failed to start OAuth authentication');
    } finally {
      setStartingAuth(null);
    }
  };

  const submitCode = async () => {
    if (!activeSession?.id || !authCode.trim()) return;
    setSubmittingCode(true);
    try {
      const res = await fetch(`${API_URL}/api/cli-auth/sessions/${activeSession.id}/submit-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: authCode.trim() })
      });
      const data = await res.json();
      if (!data.success) {
        alert(data.error?.message || 'Failed to submit code');
      }
    } catch (error) {
      console.error('Failed to submit code:', error);
      alert('Failed to submit code');
    } finally {
      setSubmittingCode(false);
    }
  };

  const cancelSession = async () => {
    if (!activeSession?.id) return;
    try {
      await fetch(`${API_URL}/api/cli-auth/sessions/${activeSession.id}/cancel`, { method: 'POST' });
      setActiveSession(null);
      setOutput([]);
    } catch (error) {
      console.error('Failed to cancel session:', error);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const loadToolsStatus = async () => {
    setToolsLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/settings/tools/check`);
      const data = await res.json();
      if (data.success && data.data) {
        setToolsStatus(data.data);
      }
    } catch (error) {
      console.error('Failed to load tools status:', error);
    } finally {
      setToolsLoading(false);
    }
  };

  const loadAutoAuthStatus = async () => {
    setAutoAuthLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/cli-auth/auto/status`);
      const data = await res.json();
      if (data.success && data.data) {
        setAutoAuthStatus(data.data);
      }
    } catch (error) {
      console.error('Failed to load auto-auth status:', error);
    } finally {
      setAutoAuthLoading(false);
    }
  };

  const loadRemoteAuthStatus = async () => {
    setRemoteAuthLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/cli-auth/combined/status`);
      const data = await res.json();
      if (data.success && data.data) {
        setRemoteAuthStatus(data.data);
      }
    } catch (error) {
      console.error('Failed to load remote auth status:', error);
    } finally {
      setRemoteAuthLoading(false);
    }
  };

  const transferCredentials = async () => {
    setTransferring(true);
    setTransferResult(null);
    try {
      const res = await fetch(`${API_URL}/api/cli-auth/remote/transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const data = await res.json();
      if (data.success && data.data) {
        setTransferResult(data.data);
        loadRemoteAuthStatus();
      } else {
        setTransferResult({
          success: false,
          method: 'scp',
          target: 'remote',
          credentialsPath: '',
          message: data.error?.message || 'Transfer failed',
          timestamp: Date.now()
        });
      }
    } catch (error) {
      console.error('Failed to transfer credentials:', error);
      setTransferResult({
        success: false,
        method: 'scp',
        target: 'remote',
        credentialsPath: '',
        message: 'Failed to connect to server',
        timestamp: Date.now()
      });
    } finally {
      setTransferring(false);
    }
  };

  const verifyRemoteClaude = async () => {
    setVerifying(true);
    setVerifyResult(null);
    try {
      const res = await fetch(`${API_URL}/api/cli-auth/remote/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const data = await res.json();
      if (data.success && data.data) {
        setVerifyResult(data.data);
      } else {
        setVerifyResult({
          success: false,
          output: data.error?.message || 'Verification failed'
        });
      }
    } catch (error) {
      console.error('Failed to verify remote Claude:', error);
      setVerifyResult({
        success: false,
        output: 'Failed to connect to server'
      });
    } finally {
      setVerifying(false);
    }
  };

  const checkExtensionConnection = () => {
    // Check if extension is installed by looking for a specific element or message
    // The extension injects a script that sets window.__CDA_EXTENSION_INSTALLED__
    const checkExtension = () => {
      // @ts-expect-error - Extension sets this global
      if (window.__CDA_EXTENSION_INSTALLED__) {
        setExtensionConnected(true);
      } else {
        // Try to send a message to the extension
        try {
          window.postMessage({ type: 'CDA_CHECK_EXTENSION' }, '*');
        } catch {
          // Extension not available
        }
      }
    };

    // Listen for extension response
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'CDA_EXTENSION_CONNECTED') {
        setExtensionConnected(true);
      }
    };

    window.addEventListener('message', handleMessage);
    checkExtension();

    return () => window.removeEventListener('message', handleMessage);
  };

  const setupApiKeyHelper = async () => {
    if (!apiKey.trim()) {
      alert('Please enter an API key');
      return;
    }

    setSettingUpApiKey(true);
    try {
      const res = await fetch(`${API_URL}/api/cli-auth/auto/setup-api-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: apiKey.trim() })
      });
      const data = await res.json();
      if (data.success) {
        alert('API Key Helper configured successfully! Claude Code will use this key.');
        setApiKey('');
        loadAutoAuthStatus();
        loadAuthStatus();
      } else {
        alert(data.error?.message || 'Failed to setup API Key Helper');
      }
    } catch (error) {
      console.error('Failed to setup API Key Helper:', error);
      alert('Failed to setup API Key Helper');
    } finally {
      setSettingUpApiKey(false);
    }
  };

  const triggerExtensionAuth = () => {
    // Send message to extension to start auto-auth
    window.postMessage({
      type: 'CDA_START_AUTO_AUTH',
      sessionId: activeSession?.id,
      authUrl: activeSession?.authUrl
    }, '*');
  };

  const startAutoAuth = async () => {
    setStartingAuth('claude-code');
    setAutoAuthMethod('extension');
    try {
      const res = await fetch(`${API_URL}/api/cli-auth/claude-code/start`, { method: 'POST' });
      const data = await res.json();
      if (data.success && data.data) {
        setActiveSession(data.data);
        // Notify extension about the new auth session
        window.postMessage({
          type: 'CDA_START_AUTO_AUTH',
          sessionId: data.data.id,
          authUrl: data.data.authUrl
        }, '*');
      } else {
        alert(data.error?.message || 'Failed to start authentication');
      }
    } catch (error) {
      console.error('Failed to start auto-auth:', error);
      alert('Failed to start authentication');
    } finally {
      setStartingAuth(null);
    }
  };

  const installTool = async (tool: string) => {
    setInstallingTool(tool);
    try {
      const res = await fetch(`${API_URL}/api/settings/tools/install`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool })
      });
      const data = await res.json();
      if (data.success) {
        await loadToolsStatus();
      } else {
        alert(`Failed to install ${tool}: ${data.error?.message || 'Unknown error'}`);
      }
    } catch (error) {
      console.error(`Failed to install ${tool}:`, error);
      alert(`Failed to install ${tool}`);
    } finally {
      setInstallingTool(null);
    }
  };

  const toolInfo = {
    'claude-code': {
      name: 'Claude Code',
      icon: Terminal,
      color: 'purple',
      description: 'Anthropic Claude Code CLI for AI-assisted development'
    },
    'azure-cli': {
      name: 'Azure CLI',
      icon: Cloud,
      color: 'blue',
      description: 'Microsoft Azure command-line interface'
    },
    'gcloud': {
      name: 'Google Cloud SDK',
      icon: Cloud,
      color: 'red',
      description: 'Google Cloud command-line tools'
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold">CLI Authentication</h1>
          <p className="text-muted-foreground">Manage authentication for CLI tools on the remote server</p>
        </div>
        <button
          onClick={() => { loadAuthStatus(); loadToolsStatus(); }}
          className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border hover:bg-accent"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh All
        </button>
      </div>

      {/* Server Tools Status */}
      <div className="mb-8 rounded-lg border border-border p-6 bg-muted/30">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Server className="w-5 h-5 text-blue-600" />
            <h2 className="text-lg font-semibold">Server Tools Status</h2>
            {toolsStatus && (
              <span className="text-xs text-muted-foreground ml-2">
                Host: {toolsStatus.host}
              </span>
            )}
          </div>
          <button
            onClick={loadToolsStatus}
            disabled={toolsLoading}
            className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg border border-border hover:bg-accent disabled:opacity-50"
          >
            {toolsLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Refresh
          </button>
        </div>

        {toolsLoading && !toolsStatus ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
            <span className="ml-2 text-muted-foreground">Checking server tools...</span>
          </div>
        ) : toolsStatus ? (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {Object.entries(toolsStatus.tools).map(([tool, info]) => {
              const toolDisplayNames: Record<string, string> = {
                'claude': 'Claude Code',
                'azure-cli': 'Azure CLI',
                'gcloud': 'gcloud',
                'docker': 'Docker',
                'node': 'Node.js',
                'git': 'Git',
                'python': 'Python',
                'npm': 'npm',
                'pnpm': 'pnpm'
              };
              const isAuthTool = ['claude', 'azure-cli', 'gcloud'].includes(tool);
              return (
                <div
                  key={tool}
                  className={`p-3 rounded-lg border ${
                    info.installed
                      ? 'bg-green-50/50 dark:bg-green-900/10 border-green-200 dark:border-green-800'
                      : 'bg-red-50/50 dark:bg-red-900/10 border-red-200 dark:border-red-800'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {info.installed ? (
                        <CheckCircle className="w-4 h-4 text-green-500" />
                      ) : (
                        <XCircle className="w-4 h-4 text-red-500" />
                      )}
                      <span className="font-medium text-sm">{toolDisplayNames[tool] || tool}</span>
                    </div>
                    {isAuthTool && (
                      <span title="Requires authentication">
                        <Package className="w-3 h-3 text-purple-500" />
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 truncate" title={info.version}>
                    {info.installed ? info.version : 'Not installed'}
                  </p>
                  {!info.installed && ['claude', 'azure-cli', 'node', 'git', 'python'].includes(tool) && (
                    <button
                      onClick={() => installTool(tool)}
                      disabled={installingTool !== null}
                      className="mt-2 flex items-center gap-1 px-2 py-1 text-xs rounded bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 w-full justify-center"
                    >
                      {installingTool === tool ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Download className="w-3 h-3" />
                      )}
                      Install
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-4">
            Click "Refresh" to check installed tools on the server
          </p>
        )}

        {toolsStatus && (
          <p className="text-xs text-muted-foreground mt-3 text-right">
            Last checked: {new Date(toolsStatus.checkedAt).toLocaleString()}
          </p>
        )}
      </div>

      {/* Auto-Auth Section */}
      <div className="mb-8 rounded-lg border border-purple-200 dark:border-purple-800 p-6 bg-purple-50/30 dark:bg-purple-900/10">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900/30">
              <Zap className="w-5 h-5 text-purple-600 dark:text-purple-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Auto-Authentication</h2>
              <p className="text-sm text-muted-foreground">Fully automated Claude Code authentication</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {autoAuthStatus?.authenticated ? (
              <span className="flex items-center gap-1 px-2 py-1 text-xs rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">
                <CheckCircle className="w-3 h-3" />
                Authenticated via {autoAuthStatus.method}
              </span>
            ) : (
              <span className="flex items-center gap-1 px-2 py-1 text-xs rounded-full bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300">
                <Shield className="w-3 h-3" />
                Not authenticated
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Chrome Extension Method */}
          <div className="p-4 rounded-lg border border-border bg-background">
            <div className="flex items-center gap-3 mb-3">
              <Chrome className="w-5 h-5 text-blue-500" />
              <div>
                <h3 className="font-medium">Chrome Extension</h3>
                <p className="text-xs text-muted-foreground">Auto-authorize OAuth flow</p>
              </div>
              {extensionConnected ? (
                <span className="ml-auto flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">
                  <CheckCircle className="w-3 h-3" />
                  Connected
                </span>
              ) : (
                <span className="ml-auto flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
                  Not detected
                </span>
              )}
            </div>

            <p className="text-sm text-muted-foreground mb-3">
              Install the CDA Chrome extension to automatically handle OAuth authorization.
              The extension will auto-click "Authorize" buttons and capture auth codes.
            </p>

            <div className="flex gap-2">
              <button
                onClick={startAutoAuth}
                disabled={startingAuth !== null || !extensionConnected}
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50"
              >
                {startingAuth === 'claude-code' && autoAuthMethod === 'extension' ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Zap className="w-4 h-4" />
                )}
                Auto-Authenticate
              </button>
              {!extensionConnected && (
                <a
                  href="chrome://extensions"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-border hover:bg-accent"
                >
                  <Download className="w-4 h-4" />
                  Install
                </a>
              )}
            </div>

            {activeSession && autoAuthMethod === 'extension' && (
              <div className="mt-3 p-2 rounded bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 text-xs">
                <div className="flex items-center gap-2">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Extension is handling authentication...
                </div>
                <button
                  onClick={triggerExtensionAuth}
                  className="mt-2 text-xs underline"
                >
                  Retry with extension
                </button>
              </div>
            )}
          </div>

          {/* API Key Method */}
          <div className="p-4 rounded-lg border border-border bg-background">
            <div className="flex items-center gap-3 mb-3">
              <Key className="w-5 h-5 text-amber-500" />
              <div>
                <h3 className="font-medium">API Key Helper</h3>
                <p className="text-xs text-muted-foreground">Bypass OAuth with API key</p>
              </div>
            </div>

            <p className="text-sm text-muted-foreground mb-3">
              If you have an ANTHROPIC_API_KEY, you can skip OAuth entirely.
              The key will be stored securely on the server.
            </p>

            <div className="flex gap-2 mb-2">
              <div className="relative flex-1">
                <input
                  type={showApiKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-ant-api03-..."
                  className="w-full px-3 py-2 pr-10 text-sm rounded-lg border border-border bg-background font-mono"
                />
                <button
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-accent"
                  title={showApiKey ? 'Hide API key' : 'Show API key'}
                >
                  {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <button
                onClick={setupApiKeyHelper}
                disabled={!apiKey.trim() || settingUpApiKey}
                className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {settingUpApiKey ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Shield className="w-4 h-4" />
                )}
                Setup
              </button>
            </div>

            <p className="text-xs text-muted-foreground">
              Get your API key from{' '}
              <a
                href="https://console.anthropic.com/settings/keys"
                target="_blank"
                rel="noopener noreferrer"
                className="text-purple-600 hover:underline"
              >
                console.anthropic.com
              </a>
            </p>
          </div>
        </div>

        {autoAuthStatus?.expiresAt && (
          <p className="text-xs text-muted-foreground mt-3">
            Authentication expires: {new Date(autoAuthStatus.expiresAt).toLocaleString()}
          </p>
        )}
      </div>

      {/* Remote Auth Section */}
      <div className="mb-8 rounded-lg border border-blue-200 dark:border-blue-800 p-6 bg-blue-50/30 dark:bg-blue-900/10">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30">
              <ArrowRightLeft className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Credential Transfer</h2>
              <p className="text-sm text-muted-foreground">Sync Claude credentials between local and remote server</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {remoteAuthStatus?.synced ? (
              <span className="flex items-center gap-1 px-2 py-1 text-xs rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">
                <CheckCircle className="w-3 h-3" />
                Synced
              </span>
            ) : (
              <span className="flex items-center gap-1 px-2 py-1 text-xs rounded-full bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300">
                <ArrowRightLeft className="w-3 h-3" />
                Not synced
              </span>
            )}
            <button
              onClick={loadRemoteAuthStatus}
              disabled={remoteAuthLoading}
              className="p-1.5 rounded-lg hover:bg-accent"
            >
              {remoteAuthLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-4">
          {/* Local Status */}
          <div className="p-4 rounded-lg border border-border bg-background">
            <div className="flex items-center gap-3 mb-3">
              <Laptop className="w-5 h-5 text-slate-500" />
              <div>
                <h3 className="font-medium">Local Machine</h3>
                <p className="text-xs text-muted-foreground">{remoteAuthStatus?.local?.credentialsPath || '~/.claude/.credentials.json'}</p>
              </div>
              {remoteAuthStatus?.local?.authenticated ? (
                <CheckCircle className="w-5 h-5 text-green-500 ml-auto" />
              ) : (
                <XCircle className="w-5 h-5 text-red-500 ml-auto" />
              )}
            </div>

            {remoteAuthStatus?.local ? (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Status:</span>
                  <span className={
                    remoteAuthStatus.local.status === 'active' ? 'text-green-600' :
                    remoteAuthStatus.local.status === 'expiring_soon' ? 'text-yellow-600' :
                    'text-red-600'
                  }>
                    {remoteAuthStatus.local.status}
                  </span>
                </div>
                {remoteAuthStatus.local.subscription && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Plan:</span>
                    <span className="text-purple-600 font-medium">{remoteAuthStatus.local.subscription}</span>
                  </div>
                )}
                {remoteAuthStatus.local.rateLimitTier && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Rate Limit:</span>
                    <span className="text-blue-600 text-xs">{remoteAuthStatus.local.rateLimitTier}</span>
                  </div>
                )}
                {remoteAuthStatus.local.expiresIn && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Expires In:</span>
                    <span className={
                      remoteAuthStatus.local.status === 'expiring_soon' ? 'text-yellow-600 font-medium' : ''
                    }>{remoteAuthStatus.local.expiresIn}</span>
                  </div>
                )}
                {remoteAuthStatus.local.expiresAt && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Expires At:</span>
                    <span className="text-xs">{new Date(remoteAuthStatus.local.expiresAt).toLocaleString()}</span>
                  </div>
                )}
                {remoteAuthStatus.local.scopes && remoteAuthStatus.local.scopes.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-border">
                    <span className="text-muted-foreground text-xs block mb-1">Scopes:</span>
                    <div className="flex flex-wrap gap-1">
                      {remoteAuthStatus.local.scopes.map((scope, idx) => (
                        <span key={idx} className="px-1.5 py-0.5 text-xs rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                          {scope}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Click refresh to load status</p>
            )}
          </div>

          {/* Remote Status */}
          <div className="p-4 rounded-lg border border-border bg-background">
            <div className="flex items-center gap-3 mb-3">
              <HardDrive className="w-5 h-5 text-blue-500" />
              <div>
                <h3 className="font-medium">Remote Server</h3>
                <p className="text-xs text-muted-foreground">{remoteAuthStatus?.remote?.credentialsPath || '/root/.claude/.credentials.json'}</p>
              </div>
              {remoteAuthStatus?.remote?.authenticated ? (
                <CheckCircle className="w-5 h-5 text-green-500 ml-auto" />
              ) : (
                <XCircle className="w-5 h-5 text-red-500 ml-auto" />
              )}
            </div>

            {remoteAuthStatus?.remote ? (
              remoteAuthStatus.remote.error ? (
                <p className="text-sm text-red-600">{remoteAuthStatus.remote.error}</p>
              ) : (
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Status:</span>
                    <span className={
                      remoteAuthStatus.remote.status === 'active' ? 'text-green-600' :
                      remoteAuthStatus.remote.status === 'expiring_soon' ? 'text-yellow-600' :
                      'text-red-600'
                    }>
                      {remoteAuthStatus.remote.status}
                    </span>
                  </div>
                  {remoteAuthStatus.remote.subscription && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Plan:</span>
                      <span className="text-purple-600 font-medium">{remoteAuthStatus.remote.subscription}</span>
                    </div>
                  )}
                  {remoteAuthStatus.remote.rateLimitTier && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Rate Limit:</span>
                      <span className="text-blue-600 text-xs">{remoteAuthStatus.remote.rateLimitTier}</span>
                    </div>
                  )}
                  {remoteAuthStatus.remote.expiresIn && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Expires In:</span>
                      <span className={
                        remoteAuthStatus.remote.status === 'expiring_soon' ? 'text-yellow-600 font-medium' : ''
                      }>{remoteAuthStatus.remote.expiresIn}</span>
                    </div>
                  )}
                  {remoteAuthStatus.remote.expiresAt && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Expires At:</span>
                      <span className="text-xs">{new Date(remoteAuthStatus.remote.expiresAt).toLocaleString()}</span>
                    </div>
                  )}
                  {remoteAuthStatus.remote.scopes && remoteAuthStatus.remote.scopes.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-border">
                      <span className="text-muted-foreground text-xs block mb-1">Scopes:</span>
                      <div className="flex flex-wrap gap-1">
                        {remoteAuthStatus.remote.scopes.map((scope, idx) => (
                          <span key={idx} className="px-1.5 py-0.5 text-xs rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                            {scope}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )
            ) : (
              <p className="text-sm text-muted-foreground">Click refresh to load status</p>
            )}
          </div>
        </div>

        {/* Transfer Actions */}
        <div className="flex flex-wrap gap-3">
          <button
            onClick={transferCredentials}
            disabled={transferring || !remoteAuthStatus?.local?.authenticated}
            className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {transferring ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Upload className="w-4 h-4" />
            )}
            Transfer to Remote
          </button>

          <button
            onClick={verifyRemoteClaude}
            disabled={verifying || !remoteAuthStatus?.remote?.authenticated}
            className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg border border-border hover:bg-accent disabled:opacity-50"
          >
            {verifying ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Terminal className="w-4 h-4" />
            )}
            Test Remote Claude
          </button>
        </div>

        {/* Transfer Result */}
        {transferResult && (
          <div className={`mt-4 p-3 rounded-lg ${
            transferResult.success
              ? 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200'
              : 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200'
          }`}>
            <div className="flex items-center gap-2">
              {transferResult.success ? <CheckCircle className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
              <span className="font-medium">{transferResult.success ? 'Transfer Successful' : 'Transfer Failed'}</span>
            </div>
            <p className="text-sm mt-1">{transferResult.message}</p>
          </div>
        )}

        {/* Verify Result */}
        {verifyResult && (
          <div className={`mt-4 p-3 rounded-lg ${
            verifyResult.success
              ? 'bg-green-50 dark:bg-green-900/20'
              : 'bg-red-50 dark:bg-red-900/20'
          }`}>
            <div className="flex items-center gap-2">
              {verifyResult.success ? (
                <CheckCircle className="w-4 h-4 text-green-600" />
              ) : (
                <XCircle className="w-4 h-4 text-red-600" />
              )}
              <span className={`font-medium ${verifyResult.success ? 'text-green-800 dark:text-green-200' : 'text-red-800 dark:text-red-200'}`}>
                {verifyResult.success ? 'Claude CLI Working' : 'Claude CLI Failed'}
              </span>
            </div>
            <pre className="mt-2 p-2 rounded bg-black/10 dark:bg-white/10 text-sm font-mono overflow-x-auto">
              {verifyResult.output}
            </pre>
          </div>
        )}
      </div>

      {/* Auth Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        {(Object.keys(toolInfo) as Array<keyof typeof toolInfo>).map((tool) => {
          const info = toolInfo[tool];
          const status = authStatus[tool];
          const Icon = info.icon;
          const isActive = activeSession?.tool === tool;

          return (
            <div
              key={tool}
              className={`rounded-lg border p-6 ${
                status?.authenticated
                  ? 'border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-900/10'
                  : 'border-border'
              }`}
            >
              <div className="flex items-center gap-3 mb-4">
                <div className={`p-2 rounded-lg bg-${info.color}-100 dark:bg-${info.color}-900/30`}>
                  <Icon className={`w-6 h-6 text-${info.color}-600 dark:text-${info.color}-400`} />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold">{info.name}</h3>
                  <p className="text-sm text-muted-foreground">{info.description}</p>
                </div>
                {status?.authenticated ? (
                  <CheckCircle className="w-6 h-6 text-green-500" />
                ) : (
                  <XCircle className="w-6 h-6 text-muted-foreground" />
                )}
              </div>

              <div className="flex items-center justify-between">
                <span className={`text-sm ${status?.authenticated ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground'}`}>
                  {status?.authenticated ? 'Authenticated' : 'Not authenticated'}
                </span>
                <button
                  onClick={() => startAuth(tool)}
                  disabled={startingAuth !== null || isActive}
                  className={`flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg ${
                    status?.authenticated
                      ? 'border border-border hover:bg-accent'
                      : 'bg-primary text-primary-foreground hover:bg-primary/90'
                  } disabled:opacity-50`}
                >
                  {startingAuth === tool ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Key className="w-4 h-4" />
                  )}
                  {status?.authenticated ? 'Re-auth' : 'Authenticate'}
                </button>
              </div>

              {status?.details && (
                <p className="mt-2 text-xs text-muted-foreground truncate">{status.details}</p>
              )}
            </div>
          );
        })}
      </div>

      {/* Active Session */}
      {activeSession && (
        <div className="rounded-lg border border-border p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <Loader2 className={`w-5 h-5 ${activeSession.status === 'success' || activeSession.status === 'failed' ? '' : 'animate-spin'}`} />
              <div>
                <h3 className="font-semibold">
                  {toolInfo[activeSession.tool]?.name} Authentication
                </h3>
                <p className="text-sm text-muted-foreground">
                  Status: <span className={
                    activeSession.status === 'success' ? 'text-green-500' :
                    activeSession.status === 'failed' ? 'text-red-500' :
                    'text-yellow-500'
                  }>{activeSession.status}</span>
                </p>
              </div>
            </div>
            {activeSession.status !== 'success' && activeSession.status !== 'failed' && (
              <button
                onClick={cancelSession}
                className="px-3 py-1.5 text-sm rounded-lg border border-red-300 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
              >
                Cancel
              </button>
            )}
          </div>

          {activeSession.message && (
            <div className={`p-3 rounded-lg mb-4 ${
              activeSession.status === 'success' ? 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200' :
              activeSession.status === 'failed' ? 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200' :
              'bg-blue-50 dark:bg-blue-900/20 text-blue-800 dark:text-blue-200'
            }`}>
              {activeSession.message}
            </div>
          )}

          {activeSession.authUrl && (
            <div className="mb-4">
              <label className="block text-sm font-medium mb-2">Authentication URL</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={activeSession.authUrl}
                  readOnly
                  className="flex-1 px-3 py-2 rounded-lg border border-border bg-muted text-sm font-mono"
                />
                <button
                  onClick={() => copyToClipboard(activeSession.authUrl!)}
                  className="p-2 rounded-lg border border-border hover:bg-accent"
                  title="Copy URL"
                >
                  <Copy className="w-4 h-4" />
                </button>
                <a
                  href={activeSession.authUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2 rounded-lg border border-border hover:bg-accent"
                  title="Open in browser"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
              </div>
            </div>
          )}

          {activeSession.userCode && (
            <div className="mb-4 p-4 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
              <div className="flex items-center gap-2 mb-3">
                <Cloud className="w-5 h-5 text-blue-600" />
                <label className="font-medium text-blue-800 dark:text-blue-200">
                  {activeSession.tool === 'azure-cli' ? 'Azure Device Code' : 'Device Code'}
                </label>
              </div>
              <div className="flex items-center gap-3 justify-center mb-3">
                <code className="px-6 py-3 rounded-lg bg-white dark:bg-slate-800 font-mono text-2xl tracking-[0.3em] font-bold text-blue-700 dark:text-blue-300 shadow-sm border border-blue-200 dark:border-blue-700">
                  {activeSession.userCode}
                </code>
                <button
                  onClick={() => {
                    copyToClipboard(activeSession.userCode!);
                  }}
                  className="p-3 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                  title="Copy code"
                >
                  <Copy className="w-5 h-5" />
                </button>
              </div>
              {activeSession.tool === 'azure-cli' && (
                <div className="text-sm text-blue-700 dark:text-blue-300 text-center">
                  <p className="font-medium mb-1">A browser window has been opened automatically.</p>
                  <p>Paste this code at <code className="px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-800">microsoft.com/devicelogin</code> to complete sign-in.</p>
                </div>
              )}
            </div>
          )}

          {activeSession.status === 'waiting_for_code' && activeSession.tool === 'claude-code' && (
            <div className="mb-4">
              <label className="block text-sm font-medium mb-2">
                Enter authentication code from browser
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={authCode}
                  onChange={(e) => setAuthCode(e.target.value)}
                  placeholder="Paste your auth code here..."
                  className="flex-1 px-3 py-2 rounded-lg border border-border bg-background font-mono"
                />
                <button
                  onClick={submitCode}
                  disabled={!authCode.trim() || submittingCode}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {submittingCode ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Key className="w-4 h-4" />
                  )}
                  Submit Code
                </button>
              </div>
            </div>
          )}

          {(activeSession.status === 'success' || activeSession.status === 'failed') && (
            <button
              onClick={() => {
                setActiveSession(null);
                setOutput([]);
                setAuthCode('');
              }}
              className="px-4 py-2 rounded-lg border border-border hover:bg-accent"
            >
              Close
            </button>
          )}

          {/* Terminal Output */}
          {output.length > 0 && (
            <div className="mt-4">
              <label className="block text-sm font-medium mb-2">Output</label>
              <div className="p-4 rounded-lg bg-black text-green-400 font-mono text-sm max-h-64 overflow-auto">
                {output.map((line, i) => (
                  <div key={i}>{line}</div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Instructions - Claude Code OAuth Re-authentication */}
      <div className="mt-8 p-6 rounded-lg border border-purple-200 dark:border-purple-800 bg-purple-50/30 dark:bg-purple-900/10">
        <h3 className="font-semibold mb-3 flex items-center gap-2">
          <Terminal className="w-5 h-5 text-purple-600" />
          Claude Code OAuth Re-authentication
        </h3>

        <div className="space-y-4">
          <div>
            <h4 className="font-medium text-sm mb-2">How the OAuth Flow Works:</h4>
            <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
              <li>Click <strong>"Re-auth"</strong> on the Claude Code card to initiate OAuth</li>
              <li>A new tab opens to <code className="px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800">console.anthropic.com/oauth/authorize</code></li>
              <li>Log in with your Anthropic account and authorize the application</li>
              <li>Credentials are automatically saved to <code className="px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800">~/.claude/.credentials.json</code></li>
              <li>The dashboard will automatically detect the new credentials</li>
            </ol>
          </div>

          <div className="pt-3 border-t border-purple-200 dark:border-purple-800">
            <h4 className="font-medium text-sm mb-2">Credential Information Explained:</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li><strong>Scopes:</strong> Permissions granted to Claude Code (e.g., <code className="px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800">user:inference</code>, <code className="px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800">user:profile</code>, <code className="px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800">user:sessions:claude_code</code>)</li>
              <li><strong>Expires In:</strong> Time remaining until the access token expires (typically 5 hours)</li>
              <li><strong>Rate Limit Tier:</strong> Your usage tier (e.g., <code className="px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800">default_claude_max_20x</code> for max subscription)</li>
              <li><strong>Subscription:</strong> Your Anthropic plan (free, pro, or max)</li>
            </ul>
          </div>

          <div className="pt-3 border-t border-purple-200 dark:border-purple-800">
            <h4 className="font-medium text-sm mb-2">When to Re-authenticate:</h4>
            <ul className="space-y-1 text-sm text-muted-foreground">
              <li>- When status shows <span className="text-red-600">"expired"</span> or <span className="text-yellow-600">"expiring_soon"</span></li>
              <li>- When you see "Not authenticated" despite having logged in before</li>
              <li>- After changing your Anthropic subscription plan</li>
              <li>- When scopes need to be updated for new features</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Instructions - Other Tools */}
      <div className="mt-4 p-6 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/30 dark:bg-blue-900/10">
        <h3 className="font-semibold mb-3 flex items-center gap-2">
          <Cloud className="w-5 h-5 text-blue-600" />
          Azure CLI & Google Cloud Authentication
        </h3>
        <div className="space-y-4">
          <div>
            <h4 className="font-medium text-sm mb-2">Azure CLI (Automatic Browser)</h4>
            <ol className="list-decimal list-inside space-y-1 text-sm text-muted-foreground">
              <li>Click <strong>"Authenticate"</strong> on the Azure CLI card</li>
              <li>A browser window opens <strong>automatically</strong> to <code className="px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800">microsoft.com/devicelogin</code></li>
              <li>Copy the device code displayed (large blue box) and paste it in the browser</li>
              <li>Sign in with your Microsoft account and authorize</li>
              <li>The dashboard will detect successful authentication automatically</li>
            </ol>
          </div>
          <div>
            <h4 className="font-medium text-sm mb-2">Google Cloud SDK (Automatic Browser)</h4>
            <ol className="list-decimal list-inside space-y-1 text-sm text-muted-foreground">
              <li>Click <strong>"Authenticate"</strong> on the Google Cloud SDK card</li>
              <li>A browser window opens <strong>automatically</strong> to Google OAuth</li>
              <li>Sign in with your Google account and authorize access</li>
              <li>The dashboard will detect successful authentication automatically</li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}
