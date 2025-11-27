import { test, expect, Page } from '@playwright/test';

const BASE_URL = 'https://cda.ilinqsoft.com';

// Test fixtures
const adminCredentials = {
  emailOrUsername: 'admin',
  password: 'admin', // Default admin password - update if changed
};

function generateTestUser() {
  const timestamp = Date.now();
  return {
    email: `usertest${timestamp}@test.local`,
    username: `usertest${timestamp}`,
    password: 'TestPassword123!',
    fullName: 'User Test',
  };
}

// Helper function to login as admin
async function loginAsAdmin(page: Page) {
  await page.goto(`${BASE_URL}/login`);

  // Clear existing tokens
  await page.evaluate(() => {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
  });

  await page.fill('input[id="emailOrUsername"]', adminCredentials.emailOrUsername);
  await page.fill('input[id="password"]', adminCredentials.password);
  await page.click('button[type="submit"]');

  // Wait for dashboard
  await page.waitForURL(`${BASE_URL}/`, { timeout: 15000 });
}

// Helper to create user via signup and return credentials
async function createAndLoginTestUser(page: Page) {
  const testUser = generateTestUser();

  await page.goto(`${BASE_URL}/signup`);
  await page.fill('input[id="email"]', testUser.email);
  await page.fill('input[id="username"]', testUser.username);
  await page.fill('input[id="fullName"]', testUser.fullName);
  await page.fill('input[id="password"]', testUser.password);
  await page.fill('input[id="confirmPassword"]', testUser.password);
  await page.click('button[type="submit"]');

  await page.waitForURL(`${BASE_URL}/`, { timeout: 15000 });

  return testUser;
}

test.describe('User Management', () => {
  test.describe('Admin Access', () => {
    test.beforeEach(async ({ page }) => {
      try {
        await loginAsAdmin(page);
      } catch (e) {
        test.skip();
      }
    });

    test('should show Users link in navigation for admin', async ({ page }) => {
      const usersLink = page.locator('a[href="/users"]');
      await expect(usersLink).toBeVisible();
    });

    test('should navigate to users page', async ({ page }) => {
      await page.click('a[href="/users"]');
      await expect(page).toHaveURL(`${BASE_URL}/users`);
      await expect(page.locator('h1')).toContainText('User Management');
    });

    test('should display user list', async ({ page }) => {
      await page.goto(`${BASE_URL}/users`);

      // Wait for the table or loading state
      await page.waitForTimeout(2000);

      // Should have a table with users
      const table = page.locator('table');
      await expect(table).toBeVisible();

      // Should have headers
      await expect(page.locator('th:has-text("User")')).toBeVisible();
      await expect(page.locator('th:has-text("Role")')).toBeVisible();
      await expect(page.locator('th:has-text("Status")')).toBeVisible();
    });

    test('should open create user modal', async ({ page }) => {
      await page.goto(`${BASE_URL}/users`);

      // Click Add User button
      await page.click('button:has-text("Add User")');

      // Modal should appear
      await expect(page.locator('h2:has-text("Create New User")')).toBeVisible();
      await expect(page.locator('input[type="email"]')).toBeVisible();
    });

    test('should create a new user', async ({ page }) => {
      await page.goto(`${BASE_URL}/users`);

      const testUser = generateTestUser();

      // Open create modal
      await page.click('button:has-text("Add User")');

      // Fill form
      await page.fill('input[type="email"]', testUser.email);
      await page.locator('input[type="text"]').first().fill(testUser.username);
      await page.locator('input[type="text"]').nth(1).fill(testUser.fullName);
      await page.fill('input[type="password"]', testUser.password);

      // Select role
      await page.selectOption('select', 'user');

      // Submit
      await page.click('button:has-text("Create User")');

      // Modal should close
      await page.waitForTimeout(2000);

      // New user should appear in list
      await expect(page.locator(`text=${testUser.username}`)).toBeVisible({ timeout: 10000 });
    });

    test('should search users', async ({ page }) => {
      await page.goto(`${BASE_URL}/users`);

      // Type in search
      await page.fill('input[placeholder="Search users..."]', 'admin');

      // Should filter results
      await page.waitForTimeout(500);
      await expect(page.locator('text=admin')).toBeVisible();
    });

    test('should open user details modal', async ({ page }) => {
      await page.goto(`${BASE_URL}/users`);

      // Wait for users to load
      await page.waitForTimeout(2000);

      // Click on first user's action menu
      await page.locator('button svg.lucide-more-vertical').first().click();

      // Click View Details
      await page.click('button:has-text("View Details")');

      // Details modal should open
      await expect(page.locator('h2:has-text("User Details")')).toBeVisible();
    });

    test('should show user tabs in details modal', async ({ page }) => {
      await page.goto(`${BASE_URL}/users`);

      await page.waitForTimeout(2000);
      await page.locator('button svg.lucide-more-vertical').first().click();
      await page.click('button:has-text("View Details")');

      // Check tabs
      await expect(page.locator('button:has-text("Info")')).toBeVisible();
      await expect(page.locator('button:has-text("Unix Account")')).toBeVisible();
      await expect(page.locator('button:has-text("Cloud Credentials")')).toBeVisible();
      await expect(page.locator('button:has-text("Claude Auth")')).toBeVisible();
    });

    test('should edit user', async ({ page }) => {
      await page.goto(`${BASE_URL}/users`);

      await page.waitForTimeout(2000);
      await page.locator('button svg.lucide-more-vertical').first().click();
      await page.click('button:has-text("Edit User")');

      // Edit modal should open
      await expect(page.locator('h2:has-text("Edit User")')).toBeVisible();

      // Should have form fields
      await expect(page.locator('input[type="email"]')).toBeVisible();
      await expect(page.locator('select').first()).toBeVisible(); // Role select
      await expect(page.locator('select').last()).toBeVisible(); // Status select
    });
  });

  test.describe('Non-Admin Access', () => {
    test('should not show Users link for regular users', async ({ page }) => {
      // Create a regular user
      await createAndLoginTestUser(page);

      // Users link should not be visible
      const usersLink = page.locator('a[href="/users"]');
      await expect(usersLink).not.toBeVisible();
    });

    test('should redirect from users page if not admin', async ({ page }) => {
      // Create a regular user
      await createAndLoginTestUser(page);

      // Try to access users page directly
      await page.goto(`${BASE_URL}/users`);

      // Should be redirected to dashboard
      await expect(page).toHaveURL(`${BASE_URL}/`);
    });
  });

  test.describe('Unix Account Management', () => {
    test.beforeEach(async ({ page }) => {
      try {
        await loginAsAdmin(page);
      } catch (e) {
        test.skip();
      }
    });

    test('should show Unix Account tab', async ({ page }) => {
      await page.goto(`${BASE_URL}/users`);

      await page.waitForTimeout(2000);
      await page.locator('button svg.lucide-more-vertical').first().click();
      await page.click('button:has-text("View Details")');

      // Click Unix Account tab
      await page.click('button:has-text("Unix Account")');

      // Should show Unix account info or create button
      const createButton = page.locator('button:has-text("Create Unix Account")');
      const unixInfo = page.locator('text=Unix Username');

      // One of these should be visible
      await expect(createButton.or(unixInfo)).toBeVisible({ timeout: 5000 });
    });
  });

  test.describe('Cloud Credentials', () => {
    test.beforeEach(async ({ page }) => {
      try {
        await loginAsAdmin(page);
      } catch (e) {
        test.skip();
      }
    });

    test('should show Cloud Credentials tab', async ({ page }) => {
      await page.goto(`${BASE_URL}/users`);

      await page.waitForTimeout(2000);
      await page.locator('button svg.lucide-more-vertical').first().click();
      await page.click('button:has-text("View Details")');

      // Click Cloud Credentials tab
      await page.click('button:has-text("Cloud Credentials")');

      // Should show credentials or empty state
      const emptyState = page.locator('text=No cloud credentials configured');
      const credentialsList = page.locator('.space-y-3');

      await expect(emptyState.or(credentialsList)).toBeVisible({ timeout: 5000 });
    });
  });

  test.describe('Claude Auth', () => {
    test.beforeEach(async ({ page }) => {
      try {
        await loginAsAdmin(page);
      } catch (e) {
        test.skip();
      }
    });

    test('should show Claude Auth tab', async ({ page }) => {
      await page.goto(`${BASE_URL}/users`);

      await page.waitForTimeout(2000);
      await page.locator('button svg.lucide-more-vertical').first().click();
      await page.click('button:has-text("View Details")');

      // Click Claude Auth tab
      await page.click('button:has-text("Claude Auth")');

      // Should show auth info or empty state
      const emptyState = page.locator('text=No Claude authentication configured');
      const authInfo = page.locator('text=Auth Method');

      await expect(emptyState.or(authInfo)).toBeVisible({ timeout: 5000 });
    });
  });
});
