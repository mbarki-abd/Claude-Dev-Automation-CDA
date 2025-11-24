import { FastifyPluginAsync } from 'fastify';
import { settingsRepository, SETTINGS_KEYS } from '../database/repositories/SettingsRepository.js';
import { createChildLogger } from '../utils/logger.js';

const logger = createChildLogger('settings-routes');

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

  // Test Hetzner SSH connection
  fastify.post('/api/settings/test/hetzner', async (_request, _reply) => {
    try {
      const settings = await settingsRepository.getHetznerSettings();

      if (!settings) {
        return { success: false, error: { message: 'Hetzner not configured' } };
      }

      // Use ssh2 library for SSH connection test
      const { Client } = await import('ssh2');

      return new Promise((resolve) => {
        const conn = new Client();
        let resolved = false;

        const timeout = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            conn.end();
            resolve({ success: false, error: { message: 'Connection timeout' } });
          }
        }, 15000);

        conn.on('ready', () => {
          conn.exec('echo connected && hostname && docker --version 2>/dev/null || echo "Docker not installed"', (err, stream) => {
            if (err) {
              clearTimeout(timeout);
              resolved = true;
              conn.end();
              resolve({ success: false, error: { message: err.message } });
              return;
            }

            let output = '';
            stream.on('data', (data: Buffer) => {
              output += data.toString();
            });
            stream.stderr.on('data', (data: Buffer) => {
              output += data.toString();
            });
            stream.on('close', () => {
              clearTimeout(timeout);
              resolved = true;
              conn.end();
              const lines = output.trim().split('\n');
              const hostname = lines[1] || 'unknown';
              const dockerInfo = lines.slice(2).join(' ') || 'unknown';
              resolve({
                success: true,
                data: {
                  status: 'connected',
                  hostname,
                  docker: dockerInfo,
                  host: settings.host
                }
              });
            });
          });
        });

        conn.on('error', (err) => {
          clearTimeout(timeout);
          if (!resolved) {
            resolved = true;
            logger.error({ err }, 'SSH connection error');
            resolve({ success: false, error: { message: err.message } });
          }
        });

        conn.connect({
          host: settings.host,
          port: settings.port || 22,
          username: settings.username,
          password: settings.authMethod === 'password' ? settings.password : undefined,
          privateKey: settings.authMethod === 'ssh-key' && settings.sshKeyPath
            ? require('fs').readFileSync(settings.sshKeyPath)
            : undefined,
          readyTimeout: 10000
        });
      });
    } catch (err) {
      logger.error({ err }, 'Hetzner connection test failed');
      return { success: false, error: { message: 'Connection test failed' } };
    }
  });

  // Get Hetzner server status
  fastify.get('/api/settings/hetzner/status', async (_request, _reply) => {
    try {
      const settings = await settingsRepository.getHetznerSettings();

      if (!settings) {
        return { success: true, data: { configured: false } };
      }

      const { Client } = await import('ssh2');

      return new Promise((resolve) => {
        const conn = new Client();
        let resolved = false;

        const timeout = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            conn.end();
            resolve({
              success: true,
              data: { configured: true, connected: false, host: settings.host }
            });
          }
        }, 10000);

        conn.on('ready', () => {
          conn.exec("docker ps --format '{{.Names}}:{{.Status}}' 2>/dev/null; df -h / | tail -1 | awk '{print $5}'; free -m | grep Mem | awk '{print $3\"/\"$2}'", (err, stream) => {
            if (err) {
              clearTimeout(timeout);
              resolved = true;
              conn.end();
              resolve({
                success: true,
                data: { configured: true, connected: false, host: settings.host, error: err.message }
              });
              return;
            }

            let output = '';
            stream.on('data', (data: Buffer) => {
              output += data.toString();
            });
            stream.on('close', () => {
              clearTimeout(timeout);
              resolved = true;
              conn.end();

              const lines = output.trim().split('\n');
              const containers: Array<{ name: string; status: string }> = [];
              let diskUsage = 'unknown';
              let memoryUsage = 'unknown';

              for (const line of lines) {
                if (line.includes(':') && !line.includes('%') && !line.includes('/')) {
                  const [name, status] = line.split(':');
                  if (name && status) {
                    containers.push({ name, status });
                  }
                } else if (line.includes('%')) {
                  diskUsage = line;
                } else if (line.includes('/') && !line.includes(':')) {
                  memoryUsage = line + ' MB';
                }
              }

              resolve({
                success: true,
                data: {
                  configured: true,
                  connected: true,
                  host: settings.host,
                  containers,
                  diskUsage,
                  memoryUsage
                }
              });
            });
          });
        });

        conn.on('error', () => {
          clearTimeout(timeout);
          if (!resolved) {
            resolved = true;
            resolve({
              success: true,
              data: { configured: true, connected: false, host: settings.host }
            });
          }
        });

        conn.connect({
          host: settings.host,
          port: settings.port || 22,
          username: settings.username,
          password: settings.authMethod === 'password' ? settings.password : undefined,
          privateKey: settings.authMethod === 'ssh-key' && settings.sshKeyPath
            ? require('fs').readFileSync(settings.sshKeyPath)
            : undefined,
          readyTimeout: 5000
        });
      });
    } catch (err) {
      logger.error({ err }, 'Failed to get Hetzner status');
      return { success: false, error: { message: 'Failed to get server status' } };
    }
  });

  // Execute command on Hetzner server
  fastify.post('/api/settings/hetzner/exec', async (request, _reply) => {
    try {
      const settings = await settingsRepository.getHetznerSettings();
      const { command } = request.body as { command: string };

      if (!settings) {
        return { success: false, error: { message: 'Hetzner not configured' } };
      }

      if (!command) {
        return { success: false, error: { message: 'Command is required' } };
      }

      const { Client } = await import('ssh2');

      return new Promise((resolve) => {
        const conn = new Client();
        let resolved = false;

        const timeout = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            conn.end();
            resolve({ success: false, error: { message: 'Command timeout' } });
          }
        }, 60000);

        conn.on('ready', () => {
          conn.exec(command, (err, stream) => {
            if (err) {
              clearTimeout(timeout);
              resolved = true;
              conn.end();
              resolve({ success: false, error: { message: err.message } });
              return;
            }

            let stdout = '';
            let stderr = '';

            stream.on('data', (data: Buffer) => {
              stdout += data.toString();
            });
            stream.stderr.on('data', (data: Buffer) => {
              stderr += data.toString();
            });
            stream.on('close', (code: number) => {
              clearTimeout(timeout);
              resolved = true;
              conn.end();
              resolve({
                success: true,
                data: { output: stdout, stderr, exitCode: code || 0 }
              });
            });
          });
        });

        conn.on('error', (err) => {
          clearTimeout(timeout);
          if (!resolved) {
            resolved = true;
            resolve({ success: false, error: { message: err.message } });
          }
        });

        conn.connect({
          host: settings.host,
          port: settings.port || 22,
          username: settings.username,
          password: settings.authMethod === 'password' ? settings.password : undefined,
          privateKey: settings.authMethod === 'ssh-key' && settings.sshKeyPath
            ? require('fs').readFileSync(settings.sshKeyPath)
            : undefined,
          readyTimeout: 10000
        });
      });
    } catch (err) {
      logger.error({ err }, 'Hetzner exec failed');
      return { success: false, error: { message: 'Command execution failed' } };
    }
  });

  // Azure CLI login using service principal
  fastify.post('/api/settings/azure/cli-login', async (_request, _reply) => {
    try {
      const settings = await settingsRepository.getAzureSettings();
      const hetznerSettings = await settingsRepository.getHetznerSettings();

      if (!settings) {
        return { success: false, error: { message: 'Azure not configured' } };
      }

      if (!settings.clientSecret || !settings.clientId || !settings.tenantId) {
        return { success: false, error: { message: 'Azure credentials incomplete (need tenantId, clientId, clientSecret)' } };
      }

      // Execute az login via SSH on remote server
      if (hetznerSettings) {
        const { Client } = await import('ssh2');

        return new Promise((resolve) => {
          const conn = new Client();
          let resolved = false;

          const timeout = setTimeout(() => {
            if (!resolved) {
              resolved = true;
              conn.end();
              resolve({ success: false, error: { message: 'Azure login timeout' } });
            }
          }, 60000);

          conn.on('ready', () => {
            const loginCommand = `az login --service-principal -u "${settings.clientId}" -p "${settings.clientSecret}" --tenant "${settings.tenantId}" 2>&1`;
            conn.exec(loginCommand, (err, stream) => {
              if (err) {
                clearTimeout(timeout);
                resolved = true;
                conn.end();
                resolve({ success: false, error: { message: err.message } });
                return;
              }

              let output = '';
              stream.on('data', (data: Buffer) => {
                output += data.toString();
              });
              stream.stderr.on('data', (data: Buffer) => {
                output += data.toString();
              });
              stream.on('close', (code: number) => {
                clearTimeout(timeout);
                resolved = true;
                conn.end();
                if (code === 0) {
                  resolve({ success: true, data: { status: 'logged_in', output } });
                } else {
                  resolve({ success: false, error: { message: output || 'Azure CLI login failed' } });
                }
              });
            });
          });

          conn.on('error', (err) => {
            clearTimeout(timeout);
            if (!resolved) {
              resolved = true;
              resolve({ success: false, error: { message: `SSH Error: ${err.message}` } });
            }
          });

          conn.connect({
            host: hetznerSettings.host,
            port: hetznerSettings.port || 22,
            username: hetznerSettings.username,
            password: hetznerSettings.authMethod === 'password' ? hetznerSettings.password : undefined,
            privateKey: hetznerSettings.authMethod === 'ssh-key' && hetznerSettings.sshKeyPath
              ? require('fs').readFileSync(hetznerSettings.sshKeyPath)
              : undefined,
            readyTimeout: 10000
          });
        });
      } else {
        return { success: false, error: { message: 'Hetzner SSH not configured - cannot run az login on remote server' } };
      }
    } catch (err) {
      logger.error({ err }, 'Azure CLI login failed');
      return { success: false, error: { message: 'Azure CLI login failed' } };
    }
  });

  // Claude Code login (browser-based OAuth)
  fastify.post('/api/settings/claude/login', async (_request, _reply) => {
    try {
      const hetznerSettings = await settingsRepository.getHetznerSettings();

      if (!hetznerSettings) {
        return { success: false, error: { message: 'Hetzner SSH not configured' } };
      }

      // Check if Claude is already logged in
      const { Client } = await import('ssh2');

      return new Promise((resolve) => {
        const conn = new Client();
        let resolved = false;

        const timeout = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            conn.end();
            resolve({ success: false, error: { message: 'Claude login check timeout' } });
          }
        }, 30000);

        conn.on('ready', () => {
          // First check if claude is installed and current auth status
          conn.exec('claude --version 2>&1 && cat ~/.config/claude/config.json 2>/dev/null || echo "NOT_CONFIGURED"', (err, stream) => {
            if (err) {
              clearTimeout(timeout);
              resolved = true;
              conn.end();
              resolve({ success: false, error: { message: err.message } });
              return;
            }

            let output = '';
            stream.on('data', (data: Buffer) => {
              output += data.toString();
            });
            stream.stderr.on('data', (data: Buffer) => {
              output += data.toString();
            });
            stream.on('close', () => {
              clearTimeout(timeout);
              resolved = true;
              conn.end();

              const isInstalled = !output.includes('command not found');
              const isConfigured = !output.includes('NOT_CONFIGURED');

              resolve({
                success: true,
                data: {
                  installed: isInstalled,
                  configured: isConfigured,
                  output: output.slice(0, 500),
                  instructions: isInstalled && !isConfigured
                    ? 'Run "claude" on the server to authenticate via browser. Use the Remote Terminal in Hetzner settings.'
                    : isInstalled && isConfigured
                    ? 'Claude Code is configured and ready'
                    : 'Claude Code is not installed. Install with: npm install -g @anthropic-ai/claude-code'
                }
              });
            });
          });
        });

        conn.on('error', (err) => {
          clearTimeout(timeout);
          if (!resolved) {
            resolved = true;
            resolve({ success: false, error: { message: `SSH Error: ${err.message}` } });
          }
        });

        conn.connect({
          host: hetznerSettings.host,
          port: hetznerSettings.port || 22,
          username: hetznerSettings.username,
          password: hetznerSettings.authMethod === 'password' ? hetznerSettings.password : undefined,
          privateKey: hetznerSettings.authMethod === 'ssh-key' && hetznerSettings.sshKeyPath
            ? require('fs').readFileSync(hetznerSettings.sshKeyPath)
            : undefined,
          readyTimeout: 10000
        });
      });
    } catch (err) {
      logger.error({ err }, 'Claude Code login check failed');
      return { success: false, error: { message: 'Claude Code login check failed' } };
    }
  });

  // Check installed tools on remote server
  fastify.get('/api/settings/tools/check', async (_request, _reply) => {
    try {
      const hetznerSettings = await settingsRepository.getHetznerSettings();

      if (!hetznerSettings) {
        return { success: false, error: { message: 'Hetzner SSH not configured' } };
      }

      const { Client } = await import('ssh2');

      return new Promise((resolve) => {
        const conn = new Client();
        let resolved = false;

        const timeout = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            conn.end();
            resolve({ success: false, error: { message: 'Tools check timeout' } });
          }
        }, 30000);

        conn.on('ready', () => {
          // Check multiple tools
          const checkCommand = `
echo "=== TOOLS CHECK ==="
echo "NODE:"
node --version 2>&1 || echo "NOT_INSTALLED"
echo "NPM:"
npm --version 2>&1 || echo "NOT_INSTALLED"
echo "DOCKER:"
docker --version 2>&1 || echo "NOT_INSTALLED"
echo "CLAUDE:"
claude --version 2>&1 || echo "NOT_INSTALLED"
echo "AZURE_CLI:"
az --version 2>&1 | head -1 || echo "NOT_INSTALLED"
echo "GIT:"
git --version 2>&1 || echo "NOT_INSTALLED"
echo "PYTHON:"
python3 --version 2>&1 || echo "NOT_INSTALLED"
echo "=== END ==="
`;
          conn.exec(checkCommand, (err, stream) => {
            if (err) {
              clearTimeout(timeout);
              resolved = true;
              conn.end();
              resolve({ success: false, error: { message: err.message } });
              return;
            }

            let output = '';
            stream.on('data', (data: Buffer) => {
              output += data.toString();
            });
            stream.stderr.on('data', (data: Buffer) => {
              output += data.toString();
            });
            stream.on('close', () => {
              clearTimeout(timeout);
              resolved = true;
              conn.end();

              // Parse tool versions
              const tools: Record<string, { installed: boolean; version: string }> = {};
              const lines = output.split('\n');
              let currentTool = '';

              for (const line of lines) {
                if (line.endsWith(':')) {
                  currentTool = line.replace(':', '').toLowerCase();
                } else if (currentTool && line.trim()) {
                  const isInstalled = !line.includes('NOT_INSTALLED') && !line.includes('command not found') && !line.includes('not found');
                  tools[currentTool] = {
                    installed: isInstalled,
                    version: isInstalled ? line.trim() : 'Not installed'
                  };
                  currentTool = '';
                }
              }

              resolve({
                success: true,
                data: {
                  host: hetznerSettings.host,
                  tools,
                  checkedAt: new Date().toISOString()
                }
              });
            });
          });
        });

        conn.on('error', (err) => {
          clearTimeout(timeout);
          if (!resolved) {
            resolved = true;
            resolve({ success: false, error: { message: `SSH Error: ${err.message}` } });
          }
        });

        conn.connect({
          host: hetznerSettings.host,
          port: hetznerSettings.port || 22,
          username: hetznerSettings.username,
          password: hetznerSettings.authMethod === 'password' ? hetznerSettings.password : undefined,
          privateKey: hetznerSettings.authMethod === 'ssh-key' && hetznerSettings.sshKeyPath
            ? require('fs').readFileSync(hetznerSettings.sshKeyPath)
            : undefined,
          readyTimeout: 10000
        });
      });
    } catch (err) {
      logger.error({ err }, 'Tools check failed');
      return { success: false, error: { message: 'Tools check failed' } };
    }
  });

  // Install tool on remote server
  fastify.post('/api/settings/tools/install', async (request, _reply) => {
    try {
      const hetznerSettings = await settingsRepository.getHetznerSettings();
      const { tool } = request.body as { tool: string };

      if (!hetznerSettings) {
        return { success: false, error: { message: 'Hetzner SSH not configured' } };
      }

      if (!tool) {
        return { success: false, error: { message: 'Tool name is required' } };
      }

      const { Client } = await import('ssh2');

      // Installation commands for each tool
      const installCommands: Record<string, string> = {
        claude: 'npm install -g @anthropic-ai/claude-code',
        'azure-cli': 'curl -sL https://aka.ms/InstallAzureCLIDeb | bash',
        node: 'curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs',
        docker: 'curl -fsSL https://get.docker.com | bash',
        git: 'apt-get update && apt-get install -y git',
        python: 'apt-get update && apt-get install -y python3 python3-pip'
      };

      const command = installCommands[tool];
      if (!command) {
        return { success: false, error: { message: `Unknown tool: ${tool}. Available: ${Object.keys(installCommands).join(', ')}` } };
      }

      return new Promise((resolve) => {
        const conn = new Client();
        let resolved = false;

        const timeout = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            conn.end();
            resolve({ success: false, error: { message: 'Installation timeout (5 min)' } });
          }
        }, 300000); // 5 minutes for installation

        conn.on('ready', () => {
          conn.exec(command, (err, stream) => {
            if (err) {
              clearTimeout(timeout);
              resolved = true;
              conn.end();
              resolve({ success: false, error: { message: err.message } });
              return;
            }

            let stdout = '';
            let stderr = '';

            stream.on('data', (data: Buffer) => {
              stdout += data.toString();
            });
            stream.stderr.on('data', (data: Buffer) => {
              stderr += data.toString();
            });
            stream.on('close', (code: number) => {
              clearTimeout(timeout);
              resolved = true;
              conn.end();

              if (code === 0) {
                resolve({
                  success: true,
                  data: {
                    tool,
                    installed: true,
                    output: stdout.slice(-1000)
                  }
                });
              } else {
                resolve({
                  success: false,
                  error: {
                    message: `Installation failed with exit code ${code}`,
                    details: (stderr || stdout).slice(-1000)
                  }
                });
              }
            });
          });
        });

        conn.on('error', (err) => {
          clearTimeout(timeout);
          if (!resolved) {
            resolved = true;
            resolve({ success: false, error: { message: `SSH Error: ${err.message}` } });
          }
        });

        conn.connect({
          host: hetznerSettings.host,
          port: hetznerSettings.port || 22,
          username: hetznerSettings.username,
          password: hetznerSettings.authMethod === 'password' ? hetznerSettings.password : undefined,
          privateKey: hetznerSettings.authMethod === 'ssh-key' && hetznerSettings.sshKeyPath
            ? require('fs').readFileSync(hetznerSettings.sshKeyPath)
            : undefined,
          readyTimeout: 10000
        });
      });
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
