import { FastifyPluginAsync } from 'fastify';
import { exec } from 'child_process';
import { promisify } from 'util';
import { settingsRepository, SETTINGS_KEYS } from '../database/repositories/SettingsRepository.js';
import { createChildLogger } from '../utils/logger.js';
import { hostname, freemem, totalmem } from 'os';

const logger = createChildLogger('settings-routes');
const execAsync = promisify(exec);

/**
 * Check installed tools locally (native execution)
 */
async function checkToolsLocal(): Promise<{ success: boolean; data: Record<string, unknown> }> {
  const tools: Record<string, { installed: boolean; version: string }> = {};

  const toolChecks = [
    { name: 'node', cmd: 'node --version' },
    { name: 'npm', cmd: 'npm --version' },
    { name: 'docker', cmd: 'docker --version' },
    { name: 'claude', cmd: 'claude --version' },
    { name: 'azure_cli', cmd: 'az --version 2>&1 | head -1' },
    { name: 'git', cmd: 'git --version' },
    { name: 'python', cmd: 'python3 --version' },
    { name: 'gcloud', cmd: 'gcloud --version 2>&1 | head -1' },
  ];

  for (const { name, cmd } of toolChecks) {
    try {
      const { stdout } = await execAsync(cmd, { timeout: 10000 });
      tools[name] = { installed: true, version: stdout.trim().split('\n')[0] };
    } catch {
      tools[name] = { installed: false, version: 'Not installed' };
    }
  }

  return {
    success: true,
    data: {
      host: hostname(),
      mode: 'local',
      tools,
      checkedAt: new Date().toISOString()
    }
  };
}

/**
 * Get local server status (native execution)
 */
async function getServerStatus(): Promise<{ success: boolean; data: Record<string, unknown> }> {
  const containers: Array<{ name: string; status: string }> = [];
  let diskUsage = 'unknown';
  const memUsed = Math.round((totalmem() - freemem()) / 1024 / 1024);
  const memTotal = Math.round(totalmem() / 1024 / 1024);
  const memoryUsage = `${memUsed}/${memTotal} MB`;

  // Get Docker containers
  try {
    const { stdout } = await execAsync("docker ps --format '{{.Names}}:{{.Status}}'", { timeout: 10000 });
    const lines = stdout.trim().split('\n').filter(l => l.includes(':'));
    for (const line of lines) {
      const [name, status] = line.split(':');
      if (name && status) {
        containers.push({ name: name.trim(), status: status.trim() });
      }
    }
  } catch {
    // Docker may not be running
  }

  // Get disk usage
  try {
    const { stdout } = await execAsync("df -h / | tail -1 | awk '{print $5}'", { timeout: 5000 });
    diskUsage = stdout.trim();
  } catch {
    // Fallback for Windows
    try {
      const { stdout } = await execAsync("wmic logicaldisk get size,freespace,caption", { timeout: 5000 });
      diskUsage = stdout.trim().split('\n')[1] || 'unknown';
    } catch {
      // Ignore
    }
  }

  return {
    success: true,
    data: {
      configured: true,
      connected: true,
      host: hostname(),
      mode: 'local',
      containers,
      diskUsage,
      memoryUsage
    }
  };
}

/**
 * Execute command locally (native execution)
 */
async function executeCommandLocal(command: string): Promise<{ success: boolean; data?: Record<string, unknown>; error?: { message: string } }> {
  try {
    const { stdout, stderr } = await execAsync(command, { timeout: 60000 });
    return {
      success: true,
      data: { output: stdout, stderr, exitCode: 0 }
    };
  } catch (err: unknown) {
    const error = err as { stdout?: string; stderr?: string; code?: number; message?: string };
    return {
      success: false,
      error: { message: error.stderr || error.message || 'Command execution failed' }
    };
  }
}

/**
 * Install tool locally (native execution)
 */
async function installToolLocal(tool: string): Promise<{ success: boolean; data?: Record<string, unknown>; error?: { message: string; details?: string } }> {
  const installCommands: Record<string, string> = {
    claude: 'npm install -g @anthropic-ai/claude-code',
    'azure-cli': 'curl -sL https://aka.ms/InstallAzureCLIDeb | bash',
    node: 'curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs',
    docker: 'curl -fsSL https://get.docker.com | bash',
    git: 'apt-get update && apt-get install -y git',
    python: 'apt-get update && apt-get install -y python3 python3-pip',
    gcloud: 'curl https://sdk.cloud.google.com | bash'
  };

  const command = installCommands[tool];
  if (!command) {
    return { success: false, error: { message: `Unknown tool: ${tool}. Available: ${Object.keys(installCommands).join(', ')}` } };
  }

  try {
    const { stdout, stderr } = await execAsync(command, { timeout: 300000 });
    return {
      success: true,
      data: {
        tool,
        installed: true,
        output: (stdout || stderr).slice(-1000)
      }
    };
  } catch (err: unknown) {
    const error = err as { stdout?: string; stderr?: string; code?: number; message?: string };
    return {
      success: false,
      error: {
        message: `Installation failed: ${error.message}`,
        details: (error.stderr || error.stdout || '').slice(-1000)
      }
    };
  }
}

/**
 * Check Claude Code authentication status locally
 */
async function checkClaudeAuthLocal(): Promise<{ success: boolean; data?: Record<string, unknown>; error?: { message: string } }> {
  let isInstalled = false;
  let isConfigured = false;
  let output = '';

  // Check if Claude is installed
  try {
    const { stdout } = await execAsync('claude --version', { timeout: 5000 });
    isInstalled = true;
    output += stdout;
  } catch {
    output = 'Claude Code is not installed';
  }

  // Check if Claude is configured
  if (isInstalled) {
    try {
      const { stdout } = await execAsync('cat ~/.config/claude/config.json 2>/dev/null || cat /root/.config/claude/config.json 2>/dev/null', { timeout: 5000 });
      isConfigured = stdout.length > 10;
      if (isConfigured) {
        output += '\nConfig found';
      }
    } catch {
      isConfigured = false;
    }
  }

  return {
    success: true,
    data: {
      installed: isInstalled,
      configured: isConfigured,
      output: output.slice(0, 500),
      instructions: isInstalled && !isConfigured
        ? 'Run "claude" in the terminal to authenticate via browser'
        : isInstalled && isConfigured
        ? 'Claude Code is configured and ready'
        : 'Claude Code is not installed. Install with: npm install -g @anthropic-ai/claude-code'
    }
  };
}

/**
 * Azure CLI login using service principal (local execution)
 */
async function azureCliLogin(clientId: string, clientSecret: string, tenantId: string): Promise<{ success: boolean; data?: Record<string, unknown>; error?: { message: string } }> {
  try {
    const loginCommand = `az login --service-principal -u "${clientId}" -p "${clientSecret}" --tenant "${tenantId}"`;
    const { stdout } = await execAsync(loginCommand, { timeout: 60000 });
    return { success: true, data: { status: 'logged_in', output: stdout.slice(0, 500) } };
  } catch (err: unknown) {
    const error = err as { stderr?: string; message?: string };
    return { success: false, error: { message: error.stderr || error.message || 'Azure CLI login failed' } };
  }
}

export const settingsRoutes: FastifyPluginAsync = async (fastify) => {
  // Get all settings
  fastify.get('/api/settings', async (_request, reply) => {
    try {
      const settings = await settingsRepository.getAll();

      // Mask sensitive data
      const maskedSettings = settings.map(s => ({
        ...s,
        value: maskSensitiveData(s.key, s.value as Record<string, unknown>)
      }));

      return {
        success: true,
        data: maskedSettings
      };
    } catch (error) {
      logger.error({ error }, 'Failed to get settings');
      reply.code(500);
      return {
        success: false,
        error: { code: 'SETTINGS_ERROR', message: 'Failed to get settings' }
      };
    }
  });

  // Get specific setting
  fastify.get('/api/settings/:key', async (request, reply) => {
    const { key } = request.params as { key: string };

    try {
      const setting = await settingsRepository.get(key);

      if (!setting) {
        return {
          success: true,
          data: null
        };
      }

      return {
        success: true,
        data: {
          ...setting,
          value: maskSensitiveData(key, setting.value as Record<string, unknown>)
        }
      };
    } catch (error) {
      logger.error({ error, key }, 'Failed to get setting');
      reply.code(500);
      return {
        success: false,
        error: { code: 'SETTINGS_ERROR', message: 'Failed to get setting' }
      };
    }
  });

  // Update setting
  fastify.put('/api/settings/:key', async (request, reply) => {
    const { key } = request.params as { key: string };
    const body = request.body as Record<string, unknown>;

    try {
      // Validate key
      if (!Object.values(SETTINGS_KEYS).includes(key as typeof SETTINGS_KEYS[keyof typeof SETTINGS_KEYS])) {
        reply.code(400);
        return {
          success: false,
          error: { code: 'INVALID_KEY', message: `Invalid settings key: ${key}` }
        };
      }

      const setting = await settingsRepository.set(key, body);

      return {
        success: true,
        data: {
          ...setting,
          value: maskSensitiveData(key, setting.value as Record<string, unknown>)
        }
      };
    } catch (error) {
      logger.error({ error, key }, 'Failed to update setting');
      reply.code(500);
      return {
        success: false,
        error: { code: 'SETTINGS_ERROR', message: 'Failed to update setting' }
      };
    }
  });

  // Delete setting
  fastify.delete('/api/settings/:key', async (request, reply) => {
    const { key } = request.params as { key: string };

    try {
      const deleted = await settingsRepository.delete(key);

      return {
        success: true,
        data: { deleted }
      };
    } catch (error) {
      logger.error({ error, key }, 'Failed to delete setting');
      reply.code(500);
      return {
        success: false,
        error: { code: 'SETTINGS_ERROR', message: 'Failed to delete setting' }
      };
    }
  });

  // Test Azure connection
  fastify.post('/api/settings/test/azure', async (_request, _reply) => {
    try {
      const settings = await settingsRepository.getAzureSettings();

      if (!settings) {
        return { success: false, error: { message: 'Azure not configured' } };
      }

      // Test by getting access token
      const tokenResponse = await fetch(
        `https://login.microsoftonline.com/${settings.tenantId}/oauth2/v2.0/token`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: settings.clientId,
            client_secret: settings.clientSecret,
            scope: 'https://graph.microsoft.com/.default',
            grant_type: 'client_credentials'
          })
        }
      );

      if (tokenResponse.ok) {
        return { success: true, data: { status: 'connected' } };
      } else {
        const errorData = await tokenResponse.json() as { error_description?: string };
        return { success: false, error: { message: errorData.error_description || 'Connection failed' } };
      }
    } catch (err) {
      logger.error({ err }, 'Azure connection test failed');
      return { success: false, error: { message: 'Connection test failed' } };
    }
  });

  // Test GitHub connection
  fastify.post('/api/settings/test/github', async (_request, _reply) => {
    try {
      const settings = await settingsRepository.getGitHubSettings();

      if (!settings?.token) {
        return { success: false, error: { message: 'GitHub not configured' } };
      }

      const response = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `token ${settings.token}`,
          Accept: 'application/vnd.github.v3+json'
        }
      });

      if (response.ok) {
        const user = await response.json() as { login: string };
        return { success: true, data: { status: 'connected', username: user.login } };
      } else {
        return { success: false, error: { message: 'Invalid token' } };
      }
    } catch (err) {
      logger.error({ err }, 'GitHub connection test failed');
      return { success: false, error: { message: 'Connection test failed' } };
    }
  });

  // Test server connection (local mode - always connected since running locally)
  fastify.post('/api/settings/test/hetzner', async (_request, _reply) => {
    try {
      // In local mode, we check local system status instead of SSH
      let dockerInfo = 'Not installed';
      try {
        const { stdout } = await execAsync('docker --version', { timeout: 5000 });
        dockerInfo = stdout.trim();
      } catch {
        // Docker not installed
      }

      return {
        success: true,
        data: {
          status: 'connected',
          hostname: hostname(),
          docker: dockerInfo,
          host: 'localhost',
          mode: 'local'
        }
      };
    } catch (err) {
      logger.error({ err }, 'Server connection test failed');
      return { success: false, error: { message: 'Connection test failed' } };
    }
  });

  // Get server status (local mode)
  fastify.get('/api/settings/hetzner/status', async (_request, _reply) => {
    try {
      // Use local server status check
      return await getServerStatus();
    } catch (err) {
      logger.error({ err }, 'Failed to get server status');
      return { success: false, error: { message: 'Failed to get server status' } };
    }
  });

  // Execute command locally
  fastify.post('/api/settings/hetzner/exec', async (request, _reply) => {
    try {
      const { command } = request.body as { command: string };

      if (!command) {
        return { success: false, error: { message: 'Command is required' } };
      }

      // Execute command locally
      return await executeCommandLocal(command);
    } catch (err) {
      logger.error({ err }, 'Command execution failed');
      return { success: false, error: { message: 'Command execution failed' } };
    }
  });

  // Azure CLI login using service principal (local execution)
  fastify.post('/api/settings/azure/cli-login', async (_request, _reply) => {
    try {
      const settings = await settingsRepository.getAzureSettings();

      if (!settings) {
        return { success: false, error: { message: 'Azure not configured' } };
      }

      if (!settings.clientSecret || !settings.clientId || !settings.tenantId) {
        return { success: false, error: { message: 'Azure credentials incomplete (need tenantId, clientId, clientSecret)' } };
      }

      // Execute az login locally
      return await azureCliLogin(settings.clientId, settings.clientSecret, settings.tenantId);
    } catch (err) {
      logger.error({ err }, 'Azure CLI login failed');
      return { success: false, error: { message: 'Azure CLI login failed' } };
    }
  });

  // Claude Code login check (local execution)
  fastify.post('/api/settings/claude/login', async (_request, _reply) => {
    try {
      // Check Claude auth status locally
      return await checkClaudeAuthLocal();
    } catch (err) {
      logger.error({ err }, 'Claude Code login check failed');
      return { success: false, error: { message: 'Claude Code login check failed' } };
    }
  });

  // Check installed tools (local execution)
  fastify.get('/api/settings/tools/check', async (_request, _reply) => {
    try {
      // Always use local mode
      return await checkToolsLocal();
    } catch (err) {
      logger.error({ err }, 'Tools check failed');
      return { success: false, error: { message: 'Tools check failed' } };
    }
  });

  // Install tool locally
  fastify.post('/api/settings/tools/install', async (request, _reply) => {
    try {
      const { tool } = request.body as { tool: string };

      if (!tool) {
        return { success: false, error: { message: 'Tool name is required' } };
      }

      // Install tool locally
      return await installToolLocal(tool);
    } catch (err) {
      logger.error({ err }, 'Tool installation failed');
      return { success: false, error: { message: 'Tool installation failed' } };
    }
  });

  // Initialize settings from environment (one-time migration)
  fastify.post('/api/settings/init-from-env', async (_request, reply) => {
    try {
      const results: Record<string, boolean> = {};

      // Azure settings
      if (process.env.AZURE_TENANT_ID && process.env.AZURE_CLIENT_ID) {
        await settingsRepository.set(SETTINGS_KEYS.AZURE, {
          tenantId: process.env.AZURE_TENANT_ID,
          clientId: process.env.AZURE_CLIENT_ID,
          clientSecret: process.env.AZURE_CLIENT_SECRET || '',
          configured: true
        });
        results.azure = true;
      }

      // GitHub settings
      if (process.env.GITHUB_TOKEN) {
        await settingsRepository.set(SETTINGS_KEYS.GITHUB, {
          token: process.env.GITHUB_TOKEN,
          username: '',
          defaultRepo: '',
          configured: true
        });
        results.github = true;
      }

      // GCloud settings
      if (process.env.GOOGLE_PROJECT_ID) {
        await settingsRepository.set(SETTINGS_KEYS.GCLOUD, {
          projectId: process.env.GOOGLE_PROJECT_ID,
          region: 'us-central1',
          credentials: process.env.GOOGLE_APPLICATION_CREDENTIALS || '',
          configured: true
        });
        results.gcloud = true;
      }

      // Claude settings
      await settingsRepository.set(SETTINGS_KEYS.CLAUDE, {
        authMethod: process.env.CLAUDE_CODE_AUTH || 'claude-ai',
        apiKey: process.env.ANTHROPIC_API_KEY || '',
        model: 'claude-sonnet-4-20250514',
        configured: true
      });
      results.claude = true;

      // Planner settings
      if (process.env.PLANNER_PLAN_ID && process.env.PLANNER_PLAN_ID !== 'your-plan-id') {
        await settingsRepository.set(SETTINGS_KEYS.PLANNER, {
          planId: process.env.PLANNER_PLAN_ID,
          syncInterval: 5,
          autoSync: true,
          buckets: { todo: '', inProgress: '', done: '' },
          configured: true
        });
        results.planner = true;
      }

      return { success: true, data: results };
    } catch (error) {
      logger.error({ error }, 'Failed to init settings from env');
      reply.code(500);
      return { success: false, error: { message: 'Failed to initialize settings' } };
    }
  });
};

// Helper to mask sensitive data
function maskSensitiveData(_key: string, value: Record<string, unknown>): Record<string, unknown> {
  const sensitiveFields = ['clientSecret', 'token', 'apiKey', 'credentials', 'password'];
  const masked = { ...value };

  for (const field of sensitiveFields) {
    if (masked[field] && typeof masked[field] === 'string') {
      const val = masked[field] as string;
      if (val.length > 8) {
        masked[field] = val.substring(0, 4) + '****' + val.substring(val.length - 4);
      } else if (val.length > 0) {
        masked[field] = '****';
      }
    }
  }

  return masked;
}
