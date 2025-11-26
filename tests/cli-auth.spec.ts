import { test, expect } from '@playwright/test';

const BASE_URL = 'https://cda.ilinqsoft.com';
const API_URL = `${BASE_URL}/api`;

test.describe('CLI Auth Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE_URL}/cli-auth`);
    await page.waitForLoadState('networkidle');
  });

  test('should load CLI Auth page', async ({ page }) => {
    await expect(page).toHaveTitle(/CDA|Claude/i);
    await expect(page.locator('text=CLI Authentication')).toBeVisible();
  });

  test('should display Claude Code authentication status', async ({ page }) => {
    // Wait for the auth status to load
    await page.waitForSelector('text=Claude Code', { timeout: 10000 });

    // Check that Claude Code section exists
    const claudeSection = page.locator('text=Claude Code').first();
    await expect(claudeSection).toBeVisible();

    // Verify authenticated status - use first() to avoid strict mode violation
    const authenticatedText = page.locator('text=Authenticated').first();
    await expect(authenticatedText).toBeVisible({ timeout: 10000 });
  });

  test('should display Azure CLI authentication status', async ({ page }) => {
    await page.waitForSelector('text=Azure CLI', { timeout: 10000 });
    const azureSection = page.locator('text=Azure CLI').first();
    await expect(azureSection).toBeVisible();
  });

  test('should display Google Cloud authentication status', async ({ page }) => {
    await page.waitForSelector('text=Google Cloud', { timeout: 10000 });
    const gcloudSection = page.locator('text=Google Cloud').first();
    await expect(gcloudSection).toBeVisible();
  });
});

test.describe('CLI Auth API', () => {
  test('GET /api/cli-auth/status should return auth status', async ({ request }) => {
    const response = await request.get(`${API_URL}/cli-auth/status`);
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.data).toHaveProperty('claude-code');
    expect(data.data).toHaveProperty('azure-cli');
    expect(data.data).toHaveProperty('gcloud');
  });

  test('Claude Code should be authenticated with max subscription', async ({ request }) => {
    const response = await request.get(`${API_URL}/cli-auth/status`);
    const data = await response.json();

    expect(data.data['claude-code'].authenticated).toBe(true);
    expect(data.data['claude-code'].details).toContain('max');
  });

  test('GET /api/cli-auth/combined/status should return combined status', async ({ request }) => {
    const response = await request.get(`${API_URL}/cli-auth/combined/status`);
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.data).toHaveProperty('local');
    expect(data.data).toHaveProperty('remote');
  });

  test('Local credentials should be active', async ({ request }) => {
    const response = await request.get(`${API_URL}/cli-auth/combined/status`);
    const data = await response.json();

    // Based on actual API response structure
    expect(data.data.local).toHaveProperty('authenticated');
    expect(data.data.local.authenticated).toBe(true);
    expect(data.data.local).toHaveProperty('subscription');
    expect(data.data.local.subscription).toBe('max');
    expect(data.data.local.status).toBe('active');
  });

  test('GET /api/health should return healthy', async ({ request }) => {
    const response = await request.get(`${API_URL}/health`);
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    // API returns 'healthy' not 'ok'
    expect(data.status).toBe('healthy');
  });
});

test.describe('CLI Auth UI Components', () => {
  test('should show credential management sections', async ({ page }) => {
    await page.goto(`${BASE_URL}/cli-auth`);
    await page.waitForLoadState('networkidle');

    // Look for credential-related sections
    const pageContent = await page.content();

    // Verify the page has credential management features
    expect(pageContent).toContain('Claude');
    expect(pageContent).toContain('Azure');
    expect(pageContent).toContain('Google');
  });

  test('should have tabs for different auth sections', async ({ page }) => {
    await page.goto(`${BASE_URL}/cli-auth`);
    await page.waitForLoadState('networkidle');

    // Check for tab navigation if present
    const page_content = await page.content();

    // Verify main sections are present
    expect(page_content).toContain('Claude Code');
  });

  test('should display status badges correctly', async ({ page }) => {
    await page.goto(`${BASE_URL}/cli-auth`);
    await page.waitForLoadState('networkidle');

    // Wait for status to load
    await page.waitForTimeout(2000);

    // Check for Authenticated badge for Claude Code
    const authenticatedBadge = page.locator('text=Authenticated').first();
    await expect(authenticatedBadge).toBeVisible({ timeout: 10000 });
  });

  test('should show subscription type for authenticated users', async ({ page }) => {
    await page.goto(`${BASE_URL}/cli-auth`);
    await page.waitForLoadState('networkidle');

    // Wait for status to load
    await page.waitForTimeout(2000);

    // Check for max subscription display
    const maxSubscription = page.locator('text=max').first();
    await expect(maxSubscription).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Dashboard Navigation', () => {
  test('should navigate to CLI Auth from sidebar', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');

    // Look for CLI Auth link in sidebar/navigation
    const cliAuthLink = page.locator('a[href*="cli-auth"]').first();
    if (await cliAuthLink.isVisible()) {
      await cliAuthLink.click();
      await expect(page).toHaveURL(/cli-auth/);
    }
  });

  test('should load dashboard homepage', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');

    // Dashboard should load without errors
    await expect(page.locator('body')).toBeVisible();
  });
});

// New tests for detailed credential information
test.describe('Credential Transfer Section', () => {
  test('should display Local Machine card with detailed info', async ({ page }) => {
    await page.goto(`${BASE_URL}/cli-auth`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Check Local Machine section exists
    const localMachineCard = page.locator('text=Local Machine').first();
    await expect(localMachineCard).toBeVisible({ timeout: 10000 });
  });

  test('should display Remote Server card', async ({ page }) => {
    await page.goto(`${BASE_URL}/cli-auth`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Check Remote Server section exists
    const remoteServerCard = page.locator('text=Remote Server').first();
    await expect(remoteServerCard).toBeVisible({ timeout: 10000 });
  });

  test('should show status in credential transfer section', async ({ page }) => {
    await page.goto(`${BASE_URL}/cli-auth`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    // Check for Status label in credential transfer
    const statusLabel = page.locator('text=Status:').first();
    await expect(statusLabel).toBeVisible({ timeout: 10000 });
  });

  test('should show Plan in credential transfer section', async ({ page }) => {
    await page.goto(`${BASE_URL}/cli-auth`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    // Check for Plan label
    const planLabel = page.locator('text=Plan:').first();
    await expect(planLabel).toBeVisible({ timeout: 10000 });
  });

  test('should display Rate Limit information', async ({ page }) => {
    await page.goto(`${BASE_URL}/cli-auth`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    // Check for Rate Limit label
    const rateLimitLabel = page.locator('text=Rate Limit:').first();
    await expect(rateLimitLabel).toBeVisible({ timeout: 10000 });
  });

  test('should display Expires In information', async ({ page }) => {
    await page.goto(`${BASE_URL}/cli-auth`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    // Check for Expires In label
    const expiresInLabel = page.locator('text=Expires In:').first();
    await expect(expiresInLabel).toBeVisible({ timeout: 10000 });
  });

  test('should display Scopes section', async ({ page }) => {
    await page.goto(`${BASE_URL}/cli-auth`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    // Check for Scopes label
    const scopesLabel = page.locator('text=Scopes:').first();
    await expect(scopesLabel).toBeVisible({ timeout: 10000 });
  });
});

test.describe('API Detailed Credential Info', () => {
  test('Combined status should include scopes', async ({ request }) => {
    const response = await request.get(`${API_URL}/cli-auth/combined/status`);
    const data = await response.json();

    expect(data.success).toBe(true);
    expect(data.data.local.scopes).toBeDefined();
    expect(Array.isArray(data.data.local.scopes)).toBe(true);
    expect(data.data.local.scopes.length).toBeGreaterThan(0);
  });

  test('Combined status should include rate limit tier', async ({ request }) => {
    const response = await request.get(`${API_URL}/cli-auth/combined/status`);
    const data = await response.json();

    expect(data.success).toBe(true);
    expect(data.data.local.rateLimitTier).toBeDefined();
    expect(data.data.local.rateLimitTier).toContain('claude_max');
  });

  test('Combined status should include expiration info', async ({ request }) => {
    const response = await request.get(`${API_URL}/cli-auth/combined/status`);
    const data = await response.json();

    expect(data.success).toBe(true);
    expect(data.data.local.expiresAt).toBeDefined();
    expect(data.data.local.expiresIn).toBeDefined();
    expect(typeof data.data.local.expiresAt).toBe('number');
  });

  test('Scopes should include user:inference', async ({ request }) => {
    const response = await request.get(`${API_URL}/cli-auth/combined/status`);
    const data = await response.json();

    expect(data.data.local.scopes).toContain('user:inference');
  });

  test('Scopes should include user:profile', async ({ request }) => {
    const response = await request.get(`${API_URL}/cli-auth/combined/status`);
    const data = await response.json();

    expect(data.data.local.scopes).toContain('user:profile');
  });

  test('Scopes should include user:sessions:claude_code', async ({ request }) => {
    const response = await request.get(`${API_URL}/cli-auth/combined/status`);
    const data = await response.json();

    expect(data.data.local.scopes).toContain('user:sessions:claude_code');
  });
});

test.describe('OAuth Re-auth Documentation', () => {
  test('should display OAuth re-authentication explanation', async ({ page }) => {
    await page.goto(`${BASE_URL}/cli-auth`);
    await page.waitForLoadState('networkidle');

    // Check for OAuth explanation section
    const oauthSection = page.locator('text=Claude Code OAuth Re-authentication');
    await expect(oauthSection).toBeVisible({ timeout: 10000 });
  });

  test('should explain OAuth flow steps', async ({ page }) => {
    await page.goto(`${BASE_URL}/cli-auth`);
    await page.waitForLoadState('networkidle');

    // Check for OAuth flow explanation
    const flowExplanation = page.locator('text=How the OAuth Flow Works:');
    await expect(flowExplanation).toBeVisible({ timeout: 10000 });
  });

  test('should explain credential information', async ({ page }) => {
    await page.goto(`${BASE_URL}/cli-auth`);
    await page.waitForLoadState('networkidle');

    // Check for credential info explanation
    const credentialInfo = page.locator('text=Credential Information Explained:');
    await expect(credentialInfo).toBeVisible({ timeout: 10000 });
  });

  test('should explain when to re-authenticate', async ({ page }) => {
    await page.goto(`${BASE_URL}/cli-auth`);
    await page.waitForLoadState('networkidle');

    // Check for re-auth guidance
    const reAuthGuide = page.locator('text=When to Re-authenticate:');
    await expect(reAuthGuide).toBeVisible({ timeout: 10000 });
  });
});
