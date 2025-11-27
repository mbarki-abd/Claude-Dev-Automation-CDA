import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { userRepository } from '../database/repositories/UserRepository.js';
import { createChildLogger } from '../utils/logger.js';

const execAsync = promisify(exec);
const logger = createChildLogger('unix-account-service');

const BASE_HOME_DIR = process.env.BASE_HOME_DIR || '/home';
const DEFAULT_SHELL = process.env.DEFAULT_SHELL || '/bin/bash';
// MIN_UID is reserved for future use
const MAX_UID = parseInt(process.env.MAX_UID || '60000', 10);

export interface UnixAccountResult {
  success: boolean;
  username?: string;
  uid?: number;
  gid?: number;
  homeDirectory?: string;
  error?: string;
}

class UnixAccountService {
  async createUnixAccount(userId: string, preferredUsername?: string): Promise<UnixAccountResult> {
    try {
      const user = await userRepository.findById(userId);
      if (!user) {
        return { success: false, error: 'User not found' };
      }

      if (user.unixUsername) {
        return {
          success: true,
          username: user.unixUsername,
          uid: user.unixUid,
          gid: user.unixGid,
          homeDirectory: user.homeDirectory,
        };
      }

      // Generate Unix username from CDA username
      const unixUsername = this.sanitizeUsername(preferredUsername || user.username);

      // Check if username is available on the system
      const isAvailable = await this.isUsernameAvailable(unixUsername);
      if (!isAvailable) {
        return { success: false, error: 'Unix username already exists on system' };
      }

      // Get next available UID
      const uid = await userRepository.getNextUnixUid();
      if (uid > MAX_UID) {
        return { success: false, error: 'No available UIDs' };
      }

      const gid = uid; // Use same value for GID
      const homeDirectory = path.join(BASE_HOME_DIR, unixUsername);

      // Create the Unix account
      await this.createSystemAccount(unixUsername, uid, gid, homeDirectory, user.fullName || user.username);

      // Update user record
      await userRepository.setUnixAccount(userId, unixUsername, uid, gid, homeDirectory);

      // Setup home directory structure
      await this.setupHomeDirectory(homeDirectory, uid, gid);

      logger.info({ userId, unixUsername, uid, homeDirectory }, 'Unix account created');

      return {
        success: true,
        username: unixUsername,
        uid,
        gid,
        homeDirectory,
      };
    } catch (error) {
      logger.error({ error, userId }, 'Failed to create Unix account');
      return { success: false, error: (error as Error).message };
    }
  }

  private sanitizeUsername(username: string): string {
    // Unix usernames: lowercase, start with letter, only alphanumeric and underscore, max 32 chars
    let sanitized = username.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    if (!/^[a-z]/.test(sanitized)) {
      sanitized = 'u_' + sanitized;
    }
    return sanitized.slice(0, 32);
  }

  private async isUsernameAvailable(username: string): Promise<boolean> {
    try {
      await execAsync(`id ${username}`);
      return false; // User exists
    } catch {
      return true; // User doesn't exist
    }
  }

  private async createSystemAccount(
    username: string,
    uid: number,
    gid: number,
    homeDirectory: string,
    fullName: string
  ): Promise<void> {
    // Create group first
    try {
      await execAsync(`groupadd -g ${gid} ${username}`);
    } catch (error) {
      // Group might already exist, continue
    }

    // Create user
    const useradd = [
      'useradd',
      '-u', uid.toString(),
      '-g', gid.toString(),
      '-m', // Create home directory
      '-d', homeDirectory,
      '-s', DEFAULT_SHELL,
      '-c', `"${fullName}"`,
      username,
    ].join(' ');

    await execAsync(useradd);
    logger.debug({ username, uid, gid }, 'System user created');
  }

  private async setupHomeDirectory(homeDirectory: string, uid: number, gid: number, _isAdmin: boolean = false): Promise<void> {
    // Create standard directories
    const directories = [
      '.config',
      '.local',
      '.local/bin',
      '.local/share',
      '.cache',
      '.ssh',
      'projects',           // User's workspace directory
      'projects/shared',    // Shared projects
      'logs',
      'tmp',                // User temp directory
    ];

    for (const dir of directories) {
      const fullPath = path.join(homeDirectory, dir);
      try {
        await fs.mkdir(fullPath, { recursive: true });
        await execAsync(`chown ${uid}:${gid} "${fullPath}"`);
      } catch (error) {
        logger.warn({ dir, error }, 'Failed to create directory');
      }
    }

    // Set SSH directory permissions
    try {
      await execAsync(`chmod 700 "${path.join(homeDirectory, '.ssh')}"`);
    } catch (error) {
      // Ignore
    }

    // Create .bashrc
    const bashrc = `# CDA User Bashrc
export PATH="$HOME/.local/bin:$PATH"
export CLAUDE_CONFIG_DIR="$HOME/.config/claude"

# Azure CLI config
export AZURE_CONFIG_DIR="$HOME/.azure"

# GCloud config
export CLOUDSDK_CONFIG="$HOME/.config/gcloud"

# PS1 prompt
PS1='\\u@cda:\\w\\$ '

# Aliases
alias ll='ls -la'
alias la='ls -A'
`;

    const bashrcPath = path.join(homeDirectory, '.bashrc');
    await fs.writeFile(bashrcPath, bashrc);
    await execAsync(`chown ${uid}:${gid} "${bashrcPath}"`);

    // Create .profile
    const profile = `# CDA User Profile
if [ -f "$HOME/.bashrc" ]; then
    . "$HOME/.bashrc"
fi
`;

    const profilePath = path.join(homeDirectory, '.profile');
    await fs.writeFile(profilePath, profile);
    await execAsync(`chown ${uid}:${gid} "${profilePath}"`);

    logger.debug({ homeDirectory }, 'Home directory setup completed');
  }

  /**
   * Grant sudo access to a user (for admin role)
   */
  async grantSudoAccess(userId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const user = await userRepository.findById(userId);
      if (!user || !user.unixUsername) {
        return { success: false, error: 'User or Unix account not found' };
      }

      const unixUsername = user.unixUsername;

      // Add user to sudo group
      await execAsync(`usermod -aG sudo ${unixUsername}`);

      // Create sudoers.d entry for passwordless sudo (limited commands)
      const sudoersContent = `# CDA Admin User: ${unixUsername}
${unixUsername} ALL=(ALL) NOPASSWD: /bin/systemctl restart *, /bin/systemctl status *, /usr/bin/docker *, /usr/bin/docker-compose *, /usr/bin/npm, /usr/bin/node, /usr/bin/pnpm
`;
      const sudoersFile = `/etc/sudoers.d/cda-${unixUsername}`;

      // Write sudoers file with correct permissions
      await fs.writeFile(sudoersFile, sudoersContent, { mode: 0o440 });
      await execAsync(`chown root:root ${sudoersFile}`);

      logger.info({ userId, unixUsername }, 'Sudo access granted');

      return { success: true };
    } catch (error) {
      logger.error({ error, userId }, 'Failed to grant sudo access');
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Revoke sudo access from a user
   */
  async revokeSudoAccess(userId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const user = await userRepository.findById(userId);
      if (!user || !user.unixUsername) {
        return { success: false, error: 'User or Unix account not found' };
      }

      const unixUsername = user.unixUsername;

      // Remove from sudo group
      try {
        await execAsync(`gpasswd -d ${unixUsername} sudo`);
      } catch (e) {
        // User might not be in group, continue
      }

      // Remove sudoers.d entry
      const sudoersFile = `/etc/sudoers.d/cda-${unixUsername}`;
      try {
        await fs.unlink(sudoersFile);
      } catch (e) {
        // File might not exist
      }

      logger.info({ userId, unixUsername }, 'Sudo access revoked');

      return { success: true };
    } catch (error) {
      logger.error({ error, userId }, 'Failed to revoke sudo access');
      return { success: false, error: (error as Error).message };
    }
  }

  async deleteUnixAccount(userId: string): Promise<boolean> {
    try {
      const user = await userRepository.findById(userId);
      if (!user || !user.unixUsername) {
        return true; // No Unix account to delete
      }

      // Delete user and home directory
      try {
        await execAsync(`userdel -r ${user.unixUsername}`);
      } catch (error) {
        logger.warn({ error, username: user.unixUsername }, 'Failed to delete system user');
      }

      // Delete group
      try {
        await execAsync(`groupdel ${user.unixUsername}`);
      } catch (error) {
        // Group might not exist or be in use
      }

      // Clear Unix account info from user record
      await userRepository.setUnixAccount(userId, '', 0, 0, '');

      logger.info({ userId, unixUsername: user.unixUsername }, 'Unix account deleted');

      return true;
    } catch (error) {
      logger.error({ error, userId }, 'Failed to delete Unix account');
      return false;
    }
  }

  async setupCloudCLIConfig(userId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const user = await userRepository.findById(userId);
      if (!user || !user.homeDirectory) {
        return { success: false, error: 'User or home directory not found' };
      }

      const homeDir = user.homeDirectory;
      const uid = user.unixUid!;
      const gid = user.unixGid!;

      // Create Azure CLI directory
      const azureDir = path.join(homeDir, '.azure');
      await fs.mkdir(azureDir, { recursive: true });
      await execAsync(`chown ${uid}:${gid} "${azureDir}"`);

      // Create GCloud directory
      const gcloudDir = path.join(homeDir, '.config', 'gcloud');
      await fs.mkdir(gcloudDir, { recursive: true });
      await execAsync(`chown -R ${uid}:${gid} "${path.join(homeDir, '.config')}"`);

      // Create Claude CLI directory
      const claudeDir = path.join(homeDir, '.config', 'claude');
      await fs.mkdir(claudeDir, { recursive: true });
      await execAsync(`chown -R ${uid}:${gid} "${claudeDir}"`);

      logger.info({ userId, homeDir }, 'Cloud CLI config directories created');

      return { success: true };
    } catch (error) {
      logger.error({ error, userId }, 'Failed to setup cloud CLI config');
      return { success: false, error: (error as Error).message };
    }
  }

  async runAsUser(
    userId: string,
    command: string,
    workDir?: string
  ): Promise<{ success: boolean; stdout: string; stderr: string; exitCode: number }> {
    try {
      const user = await userRepository.findById(userId);
      if (!user || !user.unixUsername) {
        return { success: false, stdout: '', stderr: 'User has no Unix account', exitCode: 1 };
      }

      const cwd = workDir || user.homeDirectory || `/home/${user.unixUsername}`;

      // Use sudo to run command as the user
      const fullCommand = `sudo -u ${user.unixUsername} -H bash -c 'cd "${cwd}" && ${command}'`;

      const { stdout, stderr } = await execAsync(fullCommand, {
        timeout: 60000,
        maxBuffer: 10 * 1024 * 1024,
      });

      return { success: true, stdout, stderr, exitCode: 0 };
    } catch (error: any) {
      return {
        success: false,
        stdout: error.stdout || '',
        stderr: error.stderr || error.message,
        exitCode: error.code || 1,
      };
    }
  }

  /**
   * Sync Claude CLI credentials to user's home directory
   * This writes the credentials to ~/.config/claude/credentials.json
   */
  async syncClaudeCredentials(userId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const user = await userRepository.findById(userId);
      if (!user || !user.homeDirectory || !user.unixUid || !user.unixGid) {
        return { success: false, error: 'User has no Unix account' };
      }

      // Get Claude auth from database
      const claudeAuth = await userRepository.getClaudeAuth(userId);
      if (!claudeAuth) {
        logger.debug({ userId }, 'No Claude auth to sync');
        return { success: true }; // Nothing to sync
      }

      const claudeDir = path.join(user.homeDirectory, '.config', 'claude');
      await fs.mkdir(claudeDir, { recursive: true });

      // Write credentials file based on auth method
      const credentialsPath = path.join(claudeDir, 'credentials.json');

      if (claudeAuth.auth.authMethod === 'api_key' && claudeAuth.apiKey) {
        // For API key auth, write the key
        const credentials = {
          type: 'api_key',
          apiKey: claudeAuth.apiKey,
          updatedAt: new Date().toISOString(),
        };
        await fs.writeFile(credentialsPath, JSON.stringify(credentials, null, 2));
      } else if (claudeAuth.auth.authMethod === 'oauth' && claudeAuth.tokens) {
        // For OAuth, write the tokens
        const credentials = {
          type: 'oauth',
          accessToken: claudeAuth.tokens.accessToken,
          refreshToken: claudeAuth.tokens.refreshToken,
          expiresAt: claudeAuth.tokens.expiresAt?.toISOString(),
          updatedAt: new Date().toISOString(),
        };
        await fs.writeFile(credentialsPath, JSON.stringify(credentials, null, 2));
      }

      // Set ownership to user
      await execAsync(`chown ${user.unixUid}:${user.unixGid} "${credentialsPath}"`);
      await execAsync(`chmod 600 "${credentialsPath}"`);

      logger.info({ userId, path: credentialsPath }, 'Claude credentials synced to home directory');

      return { success: true };
    } catch (error) {
      logger.error({ error, userId }, 'Failed to sync Claude credentials');
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Sync all cloud credentials to user's home directory
   */
  async syncAllCredentials(userId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const user = await userRepository.findById(userId);
      if (!user || !user.homeDirectory) {
        return { success: false, error: 'User has no Unix account' };
      }

      // Sync Claude credentials
      await this.syncClaudeCredentials(userId);

      // Get all user credentials
      const credentials = await userRepository.getUserCredentials(userId);

      for (const cred of credentials) {
        try {
          if (cred.provider === 'azure') {
            // Azure credentials go to ~/.azure/
            const azureDir = path.join(user.homeDirectory, '.azure');
            await fs.mkdir(azureDir, { recursive: true });
            // Azure stores credentials differently, skip for now
          } else if (cred.provider === 'gcloud') {
            // GCloud credentials go to ~/.config/gcloud/
            const gcloudDir = path.join(user.homeDirectory, '.config', 'gcloud');
            await fs.mkdir(gcloudDir, { recursive: true });
            // GCloud stores credentials differently, skip for now
          }
        } catch (credError) {
          logger.warn({ error: credError, provider: cred.provider }, 'Failed to sync credential');
        }
      }

      return { success: true };
    } catch (error) {
      logger.error({ error, userId }, 'Failed to sync all credentials');
      return { success: false, error: (error as Error).message };
    }
  }

  async getAccountInfo(userId: string): Promise<{
    hasUnixAccount: boolean;
    username?: string;
    uid?: number;
    gid?: number;
    homeDirectory?: string;
    homeExists?: boolean;
    diskUsage?: string;
  } | null> {
    const user = await userRepository.findById(userId);
    if (!user) return null;

    if (!user.unixUsername) {
      return { hasUnixAccount: false };
    }

    let homeExists = false;
    let diskUsage: string | undefined;

    try {
      await fs.access(user.homeDirectory!);
      homeExists = true;

      const { stdout } = await execAsync(`du -sh "${user.homeDirectory}" 2>/dev/null || echo "0"`);
      diskUsage = stdout.split('\t')[0].trim();
    } catch {
      // Home doesn't exist or can't get disk usage
    }

    return {
      hasUnixAccount: true,
      username: user.unixUsername,
      uid: user.unixUid,
      gid: user.unixGid,
      homeDirectory: user.homeDirectory,
      homeExists,
      diskUsage,
    };
  }
}

export const unixAccountService = new UnixAccountService();
