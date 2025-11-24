import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle, XCircle, Loader2, RefreshCw, Play, Cloud, Github, Server, HardDrive, Terminal, Package, Download, Key, ArrowRight } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

interface SettingValue {
  [key: string]: unknown;
}

interface Setting {
  key: string;
  value: SettingValue;
  updated_at: string;
}

interface PlannerPlan {
  id: string;
  title: string;
}

interface PlannerBucket {
  id: string;
  name: string;
}

interface HetznerStatus {
  configured: boolean;
  connected: boolean;
  host?: string;
  containers?: Array<{ name: string; status: string }>;
  diskUsage?: string;
  memoryUsage?: string;
}

interface ToolsCheckResult {
  host: string;
  tools: Record<string, { installed: boolean; version: string }>;
  checkedAt: string;
}

interface CLIAuthStatus {
  'claude-code': { authenticated: boolean; details?: string };
  'azure-cli': { authenticated: boolean; details?: string };
  'gcloud': { authenticated: boolean; details?: string };
}

export function Settings() {
  const [_settings, setSettings] = useState<Setting[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { success: boolean; message: string }>>({});
  const [plans, setPlans] = useState<PlannerPlan[]>([]);
  const [loadingPlans, setLoadingPlans] = useState(false);
  const [setupResult, setSetupResult] = useState<{ buckets?: PlannerBucket[] } | null>(null);

  // Form states
  const [azureForm, setAzureForm] = useState({ tenantId: '', clientId: '', clientSecret: '' });
  const [githubForm, setGithubForm] = useState({ token: '', username: '', defaultRepo: '' });
  const [gcloudForm, setGcloudForm] = useState({ projectId: '', region: 'us-central1' });
  const [claudeForm, setClaudeForm] = useState({ authMethod: 'claude-ai', apiKey: '', model: 'claude-sonnet-4-20250514' });
  const [plannerForm, setPlannerForm] = useState({ planId: '', syncInterval: 5, autoSync: true });
  const [hetznerForm, setHetznerForm] = useState({ host: '', port: 22, username: 'root', password: '', sshKeyPath: '', authMethod: 'password' as 'password' | 'ssh-key' });
  const [hetznerStatus, setHetznerStatus] = useState<HetznerStatus | null>(null);
  const [hetznerCommand, setHetznerCommand] = useState('');
  const [hetznerOutput, setHetznerOutput] = useState<{ output: string; stderr: string; exitCode: number } | null>(null);
  const [azureCliResult, setAzureCliResult] = useState<{ success: boolean; message: string; output?: string } | null>(null);
  const [claudeAuthResult, setClaudeAuthResult] = useState<{ installed: boolean; configured: boolean; output: string; instructions?: string } | null>(null);
  const [toolsCheck, setToolsCheck] = useState<ToolsCheckResult | null>(null);
  const [toolsLoading, setToolsLoading] = useState(false);
  const [installingTool, setInstallingTool] = useState<string | null>(null);
  const [cliAuthStatus, setCliAuthStatus] = useState<CLIAuthStatus | null>(null);
  const [cliAuthLoading, setCliAuthLoading] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const res = await fetch(`${API_URL}/api/settings`);
      const data = await res.json();
      if (data.success) {
        setSettings(data.data);
        // Populate forms
        data.data.forEach((s: Setting) => {
          if (s.key === 'azure') {
            setAzureForm(prev => ({ ...prev, ...s.value }));
          } else if (s.key === 'github') {
            setGithubForm(prev => ({ ...prev, ...s.value }));
          } else if (s.key === 'gcloud') {
            setGcloudForm(prev => ({ ...prev, ...s.value }));
          } else if (s.key === 'claude') {
            setClaudeForm(prev => ({ ...prev, ...s.value }));
          } else if (s.key === 'planner') {
            setPlannerForm(prev => ({ ...prev, ...s.value }));
          } else if (s.key === 'hetzner') {
            setHetznerForm(prev => ({ ...prev, ...s.value }));
          }
        });
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadHetznerStatus = async () => {
    try {
      const res = await fetch(`${API_URL}/api/settings/hetzner/status`);
      const data = await res.json();
      if (data.success) {
        setHetznerStatus(data.data);
      }
    } catch (error) {
      console.error('Failed to load Hetzner status:', error);
    }
  };

  const executeHetznerCommand = async () => {
    if (!hetznerCommand.trim()) return;
    setSaving('hetzner-exec');
    try {
      const res = await fetch(`${API_URL}/api/settings/hetzner/exec`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: hetznerCommand })
      });
      const data = await res.json();
      if (data.success) {
        setHetznerOutput(data.data);
      } else {
        setHetznerOutput({ output: '', stderr: data.error?.message || 'Command failed', exitCode: 1 });
      }
    } catch (error) {
      console.error('Failed to execute command:', error);
    } finally {
      setSaving(null);
    }
  };

  const saveSetting = async (key: string, value: Record<string, unknown>) => {
    setSaving(key);
    try {
      const res = await fetch(`${API_URL}/api/settings/${key}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...value, configured: true })
      });
      const data = await res.json();
      if (data.success) {
        loadSettings();
      }
    } catch (error) {
      console.error('Failed to save setting:', error);
    } finally {
      setSaving(null);
    }
  };

  const testConnection = async (service: string) => {
    setTestResults(prev => ({ ...prev, [service]: { success: false, message: 'Testing...' } }));
    try {
      const res = await fetch(`${API_URL}/api/settings/test/${service}`, { method: 'POST' });
      const data = await res.json();
      setTestResults(prev => ({
        ...prev,
        [service]: {
          success: data.success,
          message: data.success ? 'Connected!' : (data.error?.message || 'Connection failed')
        }
      }));
    } catch (error) {
      setTestResults(prev => ({
        ...prev,
        [service]: { success: false, message: 'Test failed' }
      }));
    }
  };

  const initFromEnv = async () => {
    try {
      const res = await fetch(`${API_URL}/api/settings/init-from-env`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        loadSettings();
        alert('Settings initialized from environment variables!');
      }
    } catch (error) {
      console.error('Failed to init from env:', error);
    }
  };

  const loadPlans = async () => {
    setLoadingPlans(true);
    try {
      const res = await fetch(`${API_URL}/api/planner/plans`);
      const data = await res.json();
      if (data.success) {
        setPlans(data.data);
      }
    } catch (error) {
      console.error('Failed to load plans:', error);
    } finally {
      setLoadingPlans(false);
    }
  };

  const setupPlanner = async () => {
    if (!plannerForm.planId) {
      alert('Please select a plan first');
      return;
    }
    setSaving('planner-setup');
    try {
      const res = await fetch(`${API_URL}/api/planner/setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId: plannerForm.planId })
      });
      const data = await res.json();
      if (data.success) {
        setSetupResult(data.data);
        loadSettings();
      } else {
        alert(data.error?.message || 'Setup failed');
      }
    } catch (error) {
      console.error('Failed to setup planner:', error);
    } finally {
      setSaving(null);
    }
  };

  const createTestTask = async () => {
    setSaving('test-task');
    try {
      const res = await fetch(`${API_URL}/api/planner/test-task`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        alert(`Test task created! ID: ${data.data.id}`);
      } else {
        alert(data.error?.message || 'Failed to create test task');
      }
    } catch (error) {
      console.error('Failed to create test task:', error);
    } finally {
      setSaving(null);
    }
  };

  const loginAzureCli = async () => {
    setSaving('azure-cli');
    setAzureCliResult(null);
    try {
      const res = await fetch(`${API_URL}/api/settings/azure/cli-login`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setAzureCliResult({ success: true, message: 'Azure CLI login successful!', output: data.data?.output });
      } else {
        setAzureCliResult({ success: false, message: data.error?.message || 'Azure CLI login failed' });
      }
    } catch (error) {
      console.error('Failed to login Azure CLI:', error);
      setAzureCliResult({ success: false, message: 'Failed to login to Azure CLI' });
    } finally {
      setSaving(null);
    }
  };

  const checkClaudeAuth = async () => {
    setSaving('claude-auth');
    setClaudeAuthResult(null);
    try {
      const res = await fetch(`${API_URL}/api/settings/claude/login`, { method: 'POST' });
      const data = await res.json();
      if (data.success && data.data) {
        setClaudeAuthResult(data.data);
      } else {
        setClaudeAuthResult({ installed: false, configured: false, output: data.error?.message || 'Check failed' });
      }
    } catch (error) {
      console.error('Failed to check Claude auth:', error);
      setClaudeAuthResult({ installed: false, configured: false, output: 'Failed to check Claude authentication' });
    } finally {
      setSaving(null);
    }
  };

  const checkInstalledTools = async () => {
    setToolsLoading(true);
    setToolsCheck(null);
    try {
      const res = await fetch(`${API_URL}/api/settings/tools/check`);
      const data = await res.json();
      if (data.success && data.data) {
        setToolsCheck(data.data);
      }
    } catch (error) {
      console.error('Failed to check tools:', error);
    } finally {
      setToolsLoading(false);
    }
  };

  const loadCliAuthStatus = async () => {
    setCliAuthLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/cli-auth/status`);
      const data = await res.json();
      if (data.success && data.data) {
        setCliAuthStatus(data.data);
      }
    } catch (error) {
      console.error('Failed to load CLI auth status:', error);
    } finally {
      setCliAuthLoading(false);
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
        // Refresh tools check
        await checkInstalledTools();
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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const StatusIcon = ({ service }: { service: string }) => {
    const result = testResults[service];
    if (!result) return null;
    if (result.message === 'Testing...') return <Loader2 className="w-4 h-4 animate-spin" />;
    return result.success
      ? <CheckCircle className="w-4 h-4 text-green-500" />
      : <XCircle className="w-4 h-4 text-red-500" />;
  };

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Settings</h1>
        <button
          onClick={initFromEnv}
          className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border hover:bg-accent"
        >
          <RefreshCw className="w-4 h-4" />
          Init from .env
        </button>
      </div>

      <div className="space-y-6 max-w-3xl">
        {/* Azure / Microsoft 365 */}
        <section className="rounded-lg border border-border p-6">
          <div className="flex items-center gap-2 mb-4">
            <Cloud className="w-5 h-5 text-blue-500" />
            <h2 className="text-lg font-semibold">Microsoft Azure / Planner</h2>
            <StatusIcon service="azure" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Tenant ID</label>
              <input
                type="text"
                value={azureForm.tenantId}
                onChange={e => setAzureForm({ ...azureForm, tenantId: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Client ID</label>
              <input
                type="text"
                value={azureForm.clientId}
                onChange={e => setAzureForm({ ...azureForm, clientId: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium mb-1">Client Secret</label>
              <input
                type="password"
                value={azureForm.clientSecret}
                onChange={e => setAzureForm({ ...azureForm, clientSecret: e.target.value })}
                placeholder="****"
                className="w-full px-3 py-2 rounded-lg border border-border bg-background"
              />
            </div>
          </div>

          <div className="flex gap-2 mt-4">
            <button
              onClick={() => saveSetting('azure', azureForm)}
              disabled={saving === 'azure'}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {saving === 'azure' ? 'Saving...' : 'Save'}
            </button>
            <button
              onClick={() => testConnection('azure')}
              className="px-4 py-2 rounded-lg border border-border hover:bg-accent"
            >
              Test Connection
            </button>
            <button
              onClick={loginAzureCli}
              disabled={saving === 'azure-cli'}
              className="flex items-center gap-2 px-4 py-2 rounded-lg border border-blue-500 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 disabled:opacity-50"
            >
              {saving === 'azure-cli' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Terminal className="w-4 h-4" />}
              Login via CLI (Remote)
            </button>
          </div>

          {azureCliResult && (
            <div className={`mt-4 p-4 rounded-lg border ${azureCliResult.success ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800' : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'}`}>
              <p className={`font-medium ${azureCliResult.success ? 'text-green-800 dark:text-green-200' : 'text-red-800 dark:text-red-200'}`}>
                {azureCliResult.message}
              </p>
              {azureCliResult.output && (
                <pre className="mt-2 text-sm text-muted-foreground overflow-x-auto whitespace-pre-wrap">{azureCliResult.output}</pre>
              )}
            </div>
          )}
        </section>

        {/* Planner Configuration */}
        <section className="rounded-lg border border-border p-6">
          <h2 className="text-lg font-semibold mb-4">Microsoft Planner</h2>

          <div className="space-y-4">
            <div className="flex gap-2">
              <button
                onClick={loadPlans}
                disabled={loadingPlans}
                className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border hover:bg-accent"
              >
                {loadingPlans ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                Load Plans
              </button>
            </div>

            {plans.length > 0 && (
              <div>
                <label className="block text-sm font-medium mb-1">Select Plan</label>
                <select
                  value={plannerForm.planId}
                  onChange={e => setPlannerForm({ ...plannerForm, planId: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background"
                >
                  <option value="">-- Select a plan --</option>
                  {plans.map(plan => (
                    <option key={plan.id} value={plan.id}>{plan.title}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={plannerForm.autoSync}
                  onChange={e => setPlannerForm({ ...plannerForm, autoSync: e.target.checked })}
                  className="rounded"
                />
                Auto-sync tasks
              </label>
              <div className="flex items-center gap-2">
                <span className="text-sm">Every</span>
                <input
                  type="number"
                  value={plannerForm.syncInterval}
                  onChange={e => setPlannerForm({ ...plannerForm, syncInterval: parseInt(e.target.value) })}
                  className="w-16 px-2 py-1 rounded-lg border border-border bg-background"
                  min="1"
                  max="60"
                />
                <span className="text-sm">minutes</span>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={setupPlanner}
                disabled={saving === 'planner-setup' || !plannerForm.planId}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {saving === 'planner-setup' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Server className="w-4 h-4" />}
                Setup Planner Buckets
              </button>
              <button
                onClick={createTestTask}
                disabled={saving === 'test-task'}
                className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border hover:bg-accent disabled:opacity-50"
              >
                {saving === 'test-task' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                Create Test Task
              </button>
            </div>

            {setupResult?.buckets && (
              <div className="mt-4 p-4 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
                <p className="font-medium text-green-800 dark:text-green-200 mb-2">Buckets Created:</p>
                <ul className="text-sm text-green-700 dark:text-green-300">
                  {setupResult.buckets.map(b => (
                    <li key={b.id}>{b.name}: {b.id}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </section>

        {/* GitHub */}
        <section className="rounded-lg border border-border p-6">
          <div className="flex items-center gap-2 mb-4">
            <Github className="w-5 h-5" />
            <h2 className="text-lg font-semibold">GitHub</h2>
            <StatusIcon service="github" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-sm font-medium mb-1">Personal Access Token</label>
              <input
                type="password"
                value={githubForm.token}
                onChange={e => setGithubForm({ ...githubForm, token: e.target.value })}
                placeholder="ghp_..."
                className="w-full px-3 py-2 rounded-lg border border-border bg-background"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Username</label>
              <input
                type="text"
                value={githubForm.username}
                onChange={e => setGithubForm({ ...githubForm, username: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Default Repository</label>
              <input
                type="text"
                value={githubForm.defaultRepo}
                onChange={e => setGithubForm({ ...githubForm, defaultRepo: e.target.value })}
                placeholder="owner/repo"
                className="w-full px-3 py-2 rounded-lg border border-border bg-background"
              />
            </div>
          </div>

          <div className="flex gap-2 mt-4">
            <button
              onClick={() => saveSetting('github', githubForm)}
              disabled={saving === 'github'}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {saving === 'github' ? 'Saving...' : 'Save'}
            </button>
            <button
              onClick={() => testConnection('github')}
              className="px-4 py-2 rounded-lg border border-border hover:bg-accent"
            >
              Test Connection
            </button>
          </div>
        </section>

        {/* Google Cloud */}
        <section className="rounded-lg border border-border p-6">
          <div className="flex items-center gap-2 mb-4">
            <Cloud className="w-5 h-5 text-red-500" />
            <h2 className="text-lg font-semibold">Google Cloud</h2>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Project ID</label>
              <input
                type="text"
                value={gcloudForm.projectId}
                onChange={e => setGcloudForm({ ...gcloudForm, projectId: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Region</label>
              <select
                value={gcloudForm.region}
                onChange={e => setGcloudForm({ ...gcloudForm, region: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background"
              >
                <option value="us-central1">us-central1</option>
                <option value="us-east1">us-east1</option>
                <option value="europe-west1">europe-west1</option>
                <option value="asia-east1">asia-east1</option>
              </select>
            </div>
          </div>

          <button
            onClick={() => saveSetting('gcloud', gcloudForm)}
            disabled={saving === 'gcloud'}
            className="mt-4 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {saving === 'gcloud' ? 'Saving...' : 'Save'}
          </button>
        </section>

        {/* Claude Code */}
        <section className="rounded-lg border border-border p-6">
          <h2 className="text-lg font-semibold mb-4">Claude Code</h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Authentication Method</label>
              <select
                value={claudeForm.authMethod}
                onChange={e => setClaudeForm({ ...claudeForm, authMethod: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background"
              >
                <option value="claude-ai">Claude AI (Browser Auth)</option>
                <option value="api-key">API Key</option>
              </select>
            </div>

            {claudeForm.authMethod === 'api-key' && (
              <div>
                <label className="block text-sm font-medium mb-1">Anthropic API Key</label>
                <input
                  type="password"
                  value={claudeForm.apiKey}
                  onChange={e => setClaudeForm({ ...claudeForm, apiKey: e.target.value })}
                  placeholder="sk-ant-..."
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background"
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium mb-1">Model</label>
              <select
                value={claudeForm.model}
                onChange={e => setClaudeForm({ ...claudeForm, model: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background"
              >
                <option value="claude-sonnet-4-20250514">Claude Sonnet 4</option>
                <option value="claude-3-5-sonnet-20241022">Claude 3.5 Sonnet</option>
                <option value="claude-3-opus-20240229">Claude 3 Opus</option>
              </select>
            </div>
          </div>

          <div className="flex gap-2 mt-4">
            <button
              onClick={() => saveSetting('claude', claudeForm)}
              disabled={saving === 'claude'}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {saving === 'claude' ? 'Saving...' : 'Save'}
            </button>
            <button
              onClick={checkClaudeAuth}
              disabled={saving === 'claude-auth'}
              className="flex items-center gap-2 px-4 py-2 rounded-lg border border-purple-500 text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-900/20 disabled:opacity-50"
            >
              {saving === 'claude-auth' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Terminal className="w-4 h-4" />}
              Check Auth Status (Remote)
            </button>
          </div>

          {claudeAuthResult && (
            <div className="mt-4 p-4 rounded-lg border bg-muted/50 border-border">
              <div className="flex items-center gap-2 mb-2">
                <span className={claudeAuthResult.installed ? 'text-green-500' : 'text-red-500'}>
                  {claudeAuthResult.installed ? <CheckCircle className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                </span>
                <span className="font-medium">Claude Code: {claudeAuthResult.installed ? 'Installed' : 'Not Installed'}</span>
              </div>
              <div className="flex items-center gap-2 mb-2">
                <span className={claudeAuthResult.configured ? 'text-green-500' : 'text-yellow-500'}>
                  {claudeAuthResult.configured ? <CheckCircle className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                </span>
                <span className="font-medium">Authentication: {claudeAuthResult.configured ? 'Configured' : 'Not Configured'}</span>
              </div>
              {claudeAuthResult.instructions && (
                <div className="mt-2 p-3 rounded bg-yellow-50 dark:bg-yellow-900/20 text-sm">
                  <p className="font-medium text-yellow-800 dark:text-yellow-200 mb-1">Setup Instructions:</p>
                  <p className="text-yellow-700 dark:text-yellow-300 whitespace-pre-wrap">{claudeAuthResult.instructions}</p>
                </div>
              )}
              {claudeAuthResult.output && (
                <pre className="mt-2 text-sm text-muted-foreground overflow-x-auto whitespace-pre-wrap bg-black/5 dark:bg-white/5 p-2 rounded">{claudeAuthResult.output}</pre>
              )}
            </div>
          )}
        </section>

        {/* Hetzner Remote Server */}
        <section className="rounded-lg border border-border p-6">
          <div className="flex items-center gap-2 mb-4">
            <HardDrive className="w-5 h-5 text-red-600" />
            <h2 className="text-lg font-semibold">Hetzner Remote Server (SSH)</h2>
            <StatusIcon service="hetzner" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Host / IP Address</label>
              <input
                type="text"
                value={hetznerForm.host}
                onChange={e => setHetznerForm({ ...hetznerForm, host: e.target.value })}
                placeholder="78.47.138.194"
                className="w-full px-3 py-2 rounded-lg border border-border bg-background"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">SSH Port</label>
              <input
                type="number"
                value={hetznerForm.port}
                onChange={e => setHetznerForm({ ...hetznerForm, port: parseInt(e.target.value) || 22 })}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Username</label>
              <input
                type="text"
                value={hetznerForm.username}
                onChange={e => setHetznerForm({ ...hetznerForm, username: e.target.value })}
                placeholder="root"
                className="w-full px-3 py-2 rounded-lg border border-border bg-background"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Auth Method</label>
              <select
                value={hetznerForm.authMethod}
                onChange={e => setHetznerForm({ ...hetznerForm, authMethod: e.target.value as 'password' | 'ssh-key' })}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background"
              >
                <option value="password">Password</option>
                <option value="ssh-key">SSH Key</option>
              </select>
            </div>
            {hetznerForm.authMethod === 'password' ? (
              <div className="col-span-2">
                <label className="block text-sm font-medium mb-1">Password</label>
                <input
                  type="password"
                  value={hetznerForm.password}
                  onChange={e => setHetznerForm({ ...hetznerForm, password: e.target.value })}
                  placeholder="****"
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background"
                />
              </div>
            ) : (
              <div className="col-span-2">
                <label className="block text-sm font-medium mb-1">SSH Key Path</label>
                <input
                  type="text"
                  value={hetznerForm.sshKeyPath}
                  onChange={e => setHetznerForm({ ...hetznerForm, sshKeyPath: e.target.value })}
                  placeholder="~/.ssh/id_rsa"
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background"
                />
              </div>
            )}
          </div>

          <div className="flex gap-2 mt-4">
            <button
              onClick={() => saveSetting('hetzner', hetznerForm)}
              disabled={saving === 'hetzner'}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {saving === 'hetzner' ? 'Saving...' : 'Save'}
            </button>
            <button
              onClick={() => testConnection('hetzner')}
              className="px-4 py-2 rounded-lg border border-border hover:bg-accent"
            >
              Test Connection
            </button>
            <button
              onClick={loadHetznerStatus}
              className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border hover:bg-accent"
            >
              <RefreshCw className="w-4 h-4" />
              Refresh Status
            </button>
          </div>

          {/* Server Status */}
          {hetznerStatus && (
            <div className="mt-4 p-4 rounded-lg bg-muted/50 border border-border">
              <h3 className="font-medium mb-2">Server Status</h3>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-muted-foreground">Connected:</span>{' '}
                  <span className={hetznerStatus.connected ? 'text-green-500' : 'text-red-500'}>
                    {hetznerStatus.connected ? 'Yes' : 'No'}
                  </span>
                </div>
                {hetznerStatus.host && (
                  <div>
                    <span className="text-muted-foreground">Host:</span> {hetznerStatus.host}
                  </div>
                )}
                {hetznerStatus.diskUsage && (
                  <div>
                    <span className="text-muted-foreground">Disk Usage:</span> {hetznerStatus.diskUsage}
                  </div>
                )}
                {hetznerStatus.memoryUsage && (
                  <div>
                    <span className="text-muted-foreground">Memory:</span> {hetznerStatus.memoryUsage}
                  </div>
                )}
              </div>
              {hetznerStatus.containers && hetznerStatus.containers.length > 0 && (
                <div className="mt-2">
                  <span className="text-muted-foreground text-sm">Docker Containers:</span>
                  <ul className="mt-1 space-y-1">
                    {hetznerStatus.containers.map((c, i) => (
                      <li key={i} className="text-sm flex items-center gap-2">
                        <span className={c.status.includes('Up') ? 'text-green-500' : 'text-yellow-500'}>●</span>
                        <span className="font-mono">{c.name}</span>
                        <span className="text-muted-foreground">{c.status}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Remote Terminal */}
          <div className="mt-4 border-t border-border pt-4">
            <div className="flex items-center gap-2 mb-2">
              <Terminal className="w-4 h-4" />
              <h3 className="font-medium">Remote Terminal</h3>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={hetznerCommand}
                onChange={e => setHetznerCommand(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && executeHetznerCommand()}
                placeholder="Enter command (e.g., docker ps, ls -la)"
                className="flex-1 px-3 py-2 rounded-lg border border-border bg-background font-mono text-sm"
              />
              <button
                onClick={executeHetznerCommand}
                disabled={saving === 'hetzner-exec' || !hetznerCommand.trim()}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {saving === 'hetzner-exec' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                Execute
              </button>
            </div>
            {hetznerOutput && (
              <div className="mt-2 p-3 rounded-lg bg-black text-green-400 font-mono text-sm overflow-x-auto">
                <pre className="whitespace-pre-wrap">{hetznerOutput.output || hetznerOutput.stderr}</pre>
                {hetznerOutput.exitCode !== 0 && (
                  <div className="text-red-400 mt-1">Exit code: {hetznerOutput.exitCode}</div>
                )}
              </div>
            )}
          </div>
        </section>

        {/* CLI Authentication */}
        <section className="rounded-lg border border-purple-200 dark:border-purple-800 bg-purple-50/30 dark:bg-purple-900/10 p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Key className="w-5 h-5 text-purple-600" />
              <h2 className="text-lg font-semibold">CLI Authentication</h2>
            </div>
            <Link
              to="/cli-auth"
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-600 text-white hover:bg-purple-700 transition-colors"
            >
              <Key className="w-4 h-4" />
              Manage CLI Auth
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>

          <p className="text-sm text-muted-foreground mb-4">
            Authenticate CLI tools (Claude Code, Azure CLI, gcloud) on the remote server for automated operations.
          </p>

          <div className="flex gap-2 mb-4">
            <button
              onClick={loadCliAuthStatus}
              disabled={cliAuthLoading}
              className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border hover:bg-accent"
            >
              {cliAuthLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Check Auth Status
            </button>
          </div>

          {cliAuthStatus && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {(['claude-code', 'azure-cli', 'gcloud'] as const).map((tool) => {
                const status = cliAuthStatus[tool];
                const toolNames: Record<string, string> = {
                  'claude-code': 'Claude Code',
                  'azure-cli': 'Azure CLI',
                  'gcloud': 'Google Cloud SDK'
                };
                return (
                  <div
                    key={tool}
                    className={`p-3 rounded-lg border ${
                      status?.authenticated
                        ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
                        : 'bg-background border-border'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {status?.authenticated ? (
                        <CheckCircle className="w-4 h-4 text-green-500" />
                      ) : (
                        <XCircle className="w-4 h-4 text-red-500" />
                      )}
                      <span className="font-medium">{toolNames[tool]}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {status?.authenticated ? 'Authenticated' : 'Not authenticated'}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Remote Server Tools Check */}
        <section className="rounded-lg border border-border p-6">
          <div className="flex items-center gap-2 mb-4">
            <Package className="w-5 h-5 text-green-600" />
            <h2 className="text-lg font-semibold">Remote Server Tools</h2>
          </div>

          <p className="text-sm text-muted-foreground mb-4">
            Check and install required tools on the remote Hetzner server.
          </p>

          <button
            onClick={checkInstalledTools}
            disabled={toolsLoading}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {toolsLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Check Installed Tools
          </button>

          {toolsCheck && (
            <div className="mt-4 p-4 rounded-lg bg-muted/50 border border-border">
              <div className="flex justify-between items-center mb-3">
                <h3 className="font-medium">Tools Status on {toolsCheck.host}</h3>
                <span className="text-xs text-muted-foreground">
                  Checked: {new Date(toolsCheck.checkedAt).toLocaleTimeString()}
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {Object.entries(toolsCheck.tools).map(([tool, info]) => (
                  <div key={tool} className="flex items-center justify-between p-3 rounded-lg bg-background border border-border">
                    <div className="flex items-center gap-2">
                      <span className={info.installed ? 'text-green-500' : 'text-red-500'}>
                        {info.installed ? <CheckCircle className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                      </span>
                      <div>
                        <span className="font-medium capitalize">{tool.replace('_', ' ')}</span>
                        <p className="text-xs text-muted-foreground truncate max-w-[200px]">{info.version}</p>
                      </div>
                    </div>
                    {!info.installed && ['claude', 'azure-cli', 'node', 'git', 'python'].includes(tool) && (
                      <button
                        onClick={() => installTool(tool)}
                        disabled={installingTool !== null}
                        className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50"
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
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
