/**
 * AutoAuthService - Fully automated Claude Code authentication
 *
 * Three approaches:
 * 1. API Key Helper - Bypass OAuth using existing ANTHROPIC_API_KEY
 * 2. Puppeteer automation - Automate the browser OAuth flow
 * 3. Credential injection - Directly write credentials file
 */

import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createChildLogger } from '../utils/logger.js';

const logger = createChildLogger('auto-auth');

export interface AutoAuthConfig {
  method: 'api-key-helper' | 'puppeteer' | 'credential-injection';
  apiKey?: string;
  claudeEmail?: string;
  claudePassword?: string;
}

export interface AutoAuthResult {
  success: boolean;
  method: string;
  message: string;
  credentials?: {
    accessToken?: string;
    expiresAt?: number;
  };
}

export class AutoAuthService extends EventEmitter {
  private claudeConfigDir: string;

  constructor() {
    super();
    // Claude config directory
    this.claudeConfigDir = process.env.HOME
      ? path.join(process.env.HOME, '.claude')
      : '/root/.claude';
  }

  /**
   * Method 1: API Key Helper - Use existing ANTHROPIC_API_KEY
   * This bypasses OAuth entirely by using the API key directly
   */
  async setupApiKeyHelper(apiKey: string): Promise<AutoAuthResult> {
    logger.info('Setting up API Key Helper for Claude Code');

    try {
      // Ensure .claude directory exists
      await fs.mkdir(this.claudeConfigDir, { recursive: true });

      // Create the API key helper script
      const helperPath = path.join(this.claudeConfigDir, 'anthropic_key_helper.sh');
      const helperContent = `#!/bin/bash
# Auto-generated API Key Helper for Claude Code
# This script outputs the API key when called by Claude Code
echo "${apiKey}"
`;

      await fs.writeFile(helperPath, helperContent, { mode: 0o700 });
      logger.info({ helperPath }, 'Created API key helper script');

      // Also set the environment variable in shell config
      const shellRcPath = path.join(process.env.HOME || '/root', '.bashrc');
      try {
        let bashrc = await fs.readFile(shellRcPath, 'utf-8').catch(() => '');
        if (!bashrc.includes('ANTHROPIC_API_KEY')) {
          bashrc += `\n# Claude Code API Key\nexport ANTHROPIC_API_KEY="${apiKey}"\n`;
          await fs.writeFile(shellRcPath, bashrc);
          logger.info('Added ANTHROPIC_API_KEY to .bashrc');
        }
      } catch (err) {
        logger.warn({ err }, 'Could not update .bashrc');
      }

      // Set environment variable for current process
      process.env.ANTHROPIC_API_KEY = apiKey;

      return {
        success: true,
        method: 'api-key-helper',
        message: 'API Key Helper configured successfully. Claude Code will use this key for authentication.',
      };
    } catch (err) {
      logger.error({ err }, 'Failed to setup API Key Helper');
      return {
        success: false,
        method: 'api-key-helper',
        message: `Failed to setup API Key Helper: ${(err as Error).message}`,
      };
    }
  }

  /**
   * Method 2: Credential Injection - Directly write credentials file
   * Uses tokens obtained from browser session
   */
  async injectCredentials(accessToken: string, refreshToken?: string, expiresIn?: number): Promise<AutoAuthResult> {
    logger.info('Injecting credentials directly');

    try {
      // Ensure .claude directory exists
      await fs.mkdir(this.claudeConfigDir, { recursive: true });

      const credentialsPath = path.join(this.claudeConfigDir, '.credentials.json');
      const expiresAt = Date.now() + (expiresIn || 3600) * 1000;

      const credentials = {
        access_token: accessToken,
        refresh_token: refreshToken || '',
        expires_at: expiresAt,
        token_type: 'Bearer',
        scope: 'org:create_api_key user:profile user:inference user:sessions:claude_code',
        created_at: Date.now(),
      };

      await fs.writeFile(credentialsPath, JSON.stringify(credentials, null, 2), { mode: 0o600 });
      logger.info({ credentialsPath, expiresAt }, 'Credentials injected successfully');

      return {
        success: true,
        method: 'credential-injection',
        message: 'Credentials injected successfully',
        credentials: {
          accessToken: accessToken.substring(0, 20) + '...',
          expiresAt,
        },
      };
    } catch (err) {
      logger.error({ err }, 'Failed to inject credentials');
      return {
        success: false,
        method: 'credential-injection',
        message: `Failed to inject credentials: ${(err as Error).message}`,
      };
    }
  }

  /**
   * Method 3: Puppeteer Automation - Full browser automation
   * Requires puppeteer to be installed on the server
   * Note: This is optional - if puppeteer is not installed, it will return an error
   */
  async automateOAuthWithPuppeteer(email: string, password: string): Promise<AutoAuthResult> {
    logger.info('Starting Puppeteer OAuth automation');

    try {
      // Dynamic import of puppeteer using Function constructor to avoid TypeScript static analysis
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let puppeteer: any;
      try {
        // Use dynamic require to avoid TypeScript compilation errors
        const moduleName = 'puppeteer';
        puppeteer = await (new Function('moduleName', 'return import(moduleName)'))(moduleName);
        if (!puppeteer) {
          return {
            success: false,
            method: 'puppeteer',
            message: 'Puppeteer is not installed. Run: npm install puppeteer',
          };
        }
      } catch {
        return {
          success: false,
          method: 'puppeteer',
          message: 'Puppeteer is not installed. Run: npm install puppeteer',
        };
      }

      const browser = await puppeteer.default.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });

      const page = await browser.newPage();

      // First, get the OAuth URL from Claude CLI
      const oauthUrl = await this.getOAuthUrl();
      if (!oauthUrl) {
        await browser.close();
        return {
          success: false,
          method: 'puppeteer',
          message: 'Could not get OAuth URL from Claude CLI',
        };
      }

      logger.info({ oauthUrl }, 'Navigating to OAuth URL');
      await page.goto(oauthUrl, { waitUntil: 'networkidle2' });

      // Wait for login form
      await page.waitForSelector('input[type="email"], input[name="email"]', { timeout: 10000 });

      // Fill in email
      await page.type('input[type="email"], input[name="email"]', email);

      // Click continue/next button
      const continueButton = await page.$('button[type="submit"]');
      if (continueButton) {
        await continueButton.click();
        await page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {});
      }

      // Wait for password field
      await page.waitForSelector('input[type="password"]', { timeout: 10000 });
      await page.type('input[type="password"]', password);

      // Click login/sign in button
      const loginButton = await page.$('button[type="submit"]');
      if (loginButton) {
        await loginButton.click();
      }

      // Wait for authorization page or redirect
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});

      // Look for authorize button if on consent page
      const authorizeButton = await page.$('button[type="submit"]');
      if (authorizeButton) {
        await authorizeButton.click();
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});
      }

      // Check if we got redirected with a code
      const currentUrl = page.url();
      const urlParams = new URL(currentUrl).searchParams;
      const code = urlParams.get('code');

      await browser.close();

      if (code) {
        logger.info('Successfully obtained authorization code');
        // The code would need to be exchanged for tokens
        // This typically happens automatically by the Claude CLI
        return {
          success: true,
          method: 'puppeteer',
          message: `Authorization code obtained: ${code.substring(0, 10)}...`,
        };
      }

      return {
        success: false,
        method: 'puppeteer',
        message: 'Could not complete OAuth flow automatically',
      };
    } catch (err) {
      logger.error({ err }, 'Puppeteer automation failed');
      return {
        success: false,
        method: 'puppeteer',
        message: `Puppeteer automation failed: ${(err as Error).message}`,
      };
    }
  }

  /**
   * Get OAuth URL from Claude CLI
   */
  private async getOAuthUrl(): Promise<string | null> {
    return new Promise((resolve) => {
      const proc = spawn('claude', [], {
        env: { ...process.env, TERM: 'dumb' },
      });

      let output = '';
      const timeout = setTimeout(() => {
        proc.kill();
        resolve(null);
      }, 30000);

      proc.stdout?.on('data', (data) => {
        output += data.toString();
        const match = output.match(/https:\/\/claude\.ai\/oauth\/authorize[^\s]*/);
        if (match) {
          clearTimeout(timeout);
          proc.kill();
          resolve(match[0]);
        }
      });

      proc.stderr?.on('data', (data) => {
        output += data.toString();
      });

      proc.on('close', () => {
        clearTimeout(timeout);
        resolve(null);
      });

      // Send enter to navigate menus
      setTimeout(() => proc.stdin?.write('\n'), 2000);
      setTimeout(() => proc.stdin?.write('\n'), 4000);
    });
  }

  /**
   * Check current authentication status
   */
  async checkAuthStatus(): Promise<{ authenticated: boolean; method?: string; expiresAt?: number }> {
    try {
      // Check for credentials file
      const credentialsPath = path.join(this.claudeConfigDir, '.credentials.json');
      const credentialsExist = await fs.access(credentialsPath).then(() => true).catch(() => false);

      if (credentialsExist) {
        const creds = JSON.parse(await fs.readFile(credentialsPath, 'utf-8'));
        if (creds.expires_at && creds.expires_at > Date.now()) {
          return {
            authenticated: true,
            method: 'credentials',
            expiresAt: creds.expires_at,
          };
        }
      }

      // Check for API key helper
      const helperPath = path.join(this.claudeConfigDir, 'anthropic_key_helper.sh');
      const helperExists = await fs.access(helperPath).then(() => true).catch(() => false);

      if (helperExists || process.env.ANTHROPIC_API_KEY) {
        return {
          authenticated: true,
          method: 'api-key',
        };
      }

      return { authenticated: false };
    } catch (err) {
      logger.error({ err }, 'Failed to check auth status');
      return { authenticated: false };
    }
  }

  /**
   * Full auto-authentication - tries all methods
   */
  async autoAuthenticate(config: AutoAuthConfig): Promise<AutoAuthResult> {
    logger.info({ method: config.method }, 'Starting auto-authentication');

    switch (config.method) {
      case 'api-key-helper':
        if (!config.apiKey) {
          return { success: false, method: config.method, message: 'API key is required' };
        }
        return this.setupApiKeyHelper(config.apiKey);

      case 'credential-injection':
        if (!config.apiKey) {
          return { success: false, method: config.method, message: 'Access token is required' };
        }
        return this.injectCredentials(config.apiKey);

      case 'puppeteer':
        if (!config.claudeEmail || !config.claudePassword) {
          return { success: false, method: config.method, message: 'Email and password are required' };
        }
        return this.automateOAuthWithPuppeteer(config.claudeEmail, config.claudePassword);

      default:
        return { success: false, method: 'unknown', message: 'Unknown authentication method' };
    }
  }
}

// Singleton instance
export const autoAuthService = new AutoAuthService();
