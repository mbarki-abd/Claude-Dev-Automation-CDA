import { useState, useEffect } from 'react';
import { CheckCircle, XCircle, Loader2, ExternalLink, Copy, Cloud, Terminal, Key, RefreshCw, Package, Download, Server } from 'lucide-react';

// Use empty string for relative URLs - nginx proxies /api to the backend
const API_URL = import.meta.env.VITE_API_URL || '';

interface AuthStatus {
  authenticated: boolean;
  details?: string;
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

  useEffect(() => {
    loadAuthStatus();
    loadToolsStatus();
    // Poll for status updates
    const interval = setInterval(loadAuthStatus, 10000);
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
    setStartingAuth(tool);
    setOutput([]);
    setAuthCode('');
    try {
      const res = await fetch(`${API_URL}/api/cli-auth/${tool}/start`, { method: 'POST' });
      const data = await res.json();
      if (data.success && data.data) {
        setActiveSession(data.data);
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
            <div className="mb-4">
              <label className="block text-sm font-medium mb-2">Device Code</label>
              <div className="flex items-center gap-2">
                <code className="px-4 py-2 rounded-lg bg-muted font-mono text-lg tracking-widest">
                  {activeSession.userCode}
                </code>
                <button
                  onClick={() => copyToClipboard(activeSession.userCode!)}
                  className="p-2 rounded-lg border border-border hover:bg-accent"
                  title="Copy code"
                >
                  <Copy className="w-4 h-4" />
                </button>
              </div>
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

      {/* Instructions */}
      <div className="mt-8 p-6 rounded-lg border border-border bg-muted/30">
        <h3 className="font-semibold mb-3">How it works</h3>
        <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
          <li>Click "Authenticate" on the tool you want to set up</li>
          <li>For Claude Code: Copy the auth URL, open it in your browser, log in, and paste the code back</li>
          <li>For Azure CLI: Open the device login page, enter the code shown, and complete sign-in</li>
          <li>For gcloud: Open the auth URL, sign in with your Google account, and paste the code</li>
          <li>Once authenticated, the status will update to show "Authenticated"</li>
        </ol>
      </div>
    </div>
  );
}
