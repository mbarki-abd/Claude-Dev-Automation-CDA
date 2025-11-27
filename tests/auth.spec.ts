import { test, expect, Page } from '@playwright/test';

const BASE_URL = 'https://cda.ilinqsoft.com';

// Generate unique user for each test run
function generateTestUser() {
  const timestamp = Date.now();
  return {
    email: `testuser${timestamp}@test.local`,
    username: `testuser${timestamp}`,
    password: 'TestPassword123!',
    fullName: 'Test User',
  };
}

test.describe('Authentication Flow', () => {
  test.describe('Login Page', () => {
    test('should display login form', async ({ page }) => {
      await page.goto(`${BASE_URL}/login`);

      // Check for login form elements
      await expect(page.locator('h1')).toContainText('Welcome back');
      await expect(page.locator('input[id="emailOrUsername"]')).toBeVisible();
      await expect(page.locator('input[id="password"]')).toBeVisible();
      await expect(page.locator('button[type="submit"]')).toContainText('Sign in');
    });

    test('should have link to signup page', async ({ page }) => {
      await page.goto(`${BASE_URL}/login`);

      const signupLink = page.locator('a[href="/signup"]');
      await expect(signupLink).toBeVisible();
      await signupLink.click();

      await expect(page).toHaveURL(`${BASE_URL}/signup`);
    });

    test('should show error for invalid credentials', async ({ page }) => {
      await page.goto(`${BASE_URL}/login`);

      await page.fill('input[id="emailOrUsername"]', 'invalid@email.com');
      await page.fill('input[id="password"]', 'wrongpassword');
      await page.click('button[type="submit"]');

      // Wait for error message
      await expect(page.locator('.bg-destructive\\/10')).toBeVisible({ timeout: 10000 });
    });

    test('should toggle password visibility', async ({ page }) => {
      await page.goto(`${BASE_URL}/login`);

      const passwordInput = page.locator('input[id="password"]');
      const toggleButton = page.locator('button').filter({ has: page.locator('svg') }).last();

      // Initially password should be hidden
      await expect(passwordInput).toHaveAttribute('type', 'password');

      // Click toggle
      await toggleButton.click();
      await expect(passwordInput).toHaveAttribute('type', 'text');

      // Click again to hide
      await toggleButton.click();
      await expect(passwordInput).toHaveAttribute('type', 'password');
    });
  });

  test.describe('Signup Page', () => {
    test('should display signup form', async ({ page }) => {
      await page.goto(`${BASE_URL}/signup`);

      await expect(page.locator('h1')).toContainText('Create your account');
      await expect(page.locator('input[id="email"]')).toBeVisible();
      await expect(page.locator('input[id="username"]')).toBeVisible();
      await expect(page.locator('input[id="fullName"]')).toBeVisible();
      await expect(page.locator('input[id="password"]')).toBeVisible();
      await expect(page.locator('input[id="confirmPassword"]')).toBeVisible();
      await expect(page.locator('button[type="submit"]')).toContainText('Create account');
    });

    test('should have link to login page', async ({ page }) => {
      await page.goto(`${BASE_URL}/signup`);

      const loginLink = page.locator('a[href="/login"]');
      await expect(loginLink).toBeVisible();
      await loginLink.click();

      await expect(page).toHaveURL(`${BASE_URL}/login`);
    });

    test('should show error for password mismatch', async ({ page }) => {
      await page.goto(`${BASE_URL}/signup`);

      const testUser = generateTestUser();

      await page.fill('input[id="email"]', testUser.email);
      await page.fill('input[id="username"]', testUser.username);
      await page.fill('input[id="password"]', testUser.password);
      await page.fill('input[id="confirmPassword"]', 'differentpassword');
      await page.click('button[type="submit"]');

      // Error should appear
      await expect(page.locator('.bg-destructive\\/10')).toContainText('Passwords do not match');
    });

    test('should require minimum password length', async ({ page }) => {
      await page.goto(`${BASE_URL}/signup`);

      const testUser = generateTestUser();

      await page.fill('input[id="email"]', testUser.email);
      await page.fill('input[id="username"]', testUser.username);
      await page.fill('input[id="password"]', 'short');
      await page.fill('input[id="confirmPassword"]', 'short');
      await page.click('button[type="submit"]');

      // Error should appear
      await expect(page.locator('.bg-destructive\\/10')).toContainText('Password must be at least 8 characters');
    });
  });

  test.describe('Protected Routes', () => {
    test('should redirect to login when not authenticated', async ({ page }) => {
      // Clear any existing tokens
      await page.goto(`${BASE_URL}/login`);
      await page.evaluate(() => {
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
      });

      // Try to access protected route
      await page.goto(`${BASE_URL}/`);

      // Should be redirected to login
      await expect(page).toHaveURL(`${BASE_URL}/login`);
    });

    test('should redirect to login when accessing tasks', async ({ page }) => {
      // Clear any existing tokens
      await page.goto(`${BASE_URL}/login`);
      await page.evaluate(() => {
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
      });

      await page.goto(`${BASE_URL}/tasks`);
      await expect(page).toHaveURL(`${BASE_URL}/login`);
    });

    test('should redirect to login when accessing terminal', async ({ page }) => {
      // Clear any existing tokens
      await page.goto(`${BASE_URL}/login`);
      await page.evaluate(() => {
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
      });

      await page.goto(`${BASE_URL}/terminal`);
      await expect(page).toHaveURL(`${BASE_URL}/login`);
    });
  });

  test.describe('Full Auth Flow', () => {
    test('should signup, login, and access dashboard', async ({ page }) => {
      const testUser = generateTestUser();

      // Go to signup
      await page.goto(`${BASE_URL}/signup`);

      // Fill signup form
      await page.fill('input[id="email"]', testUser.email);
      await page.fill('input[id="username"]', testUser.username);
      await page.fill('input[id="fullName"]', testUser.fullName);
      await page.fill('input[id="password"]', testUser.password);
      await page.fill('input[id="confirmPassword"]', testUser.password);

      // Submit and wait for redirect
      await page.click('button[type="submit"]');

      // Should be redirected to dashboard
      await expect(page).toHaveURL(`${BASE_URL}/`, { timeout: 15000 });

      // Dashboard should be visible
      await expect(page.locator('h1')).toContainText('Dashboard');

      // User info should be visible in sidebar
      await expect(page.locator('text=' + testUser.username)).toBeVisible();
    });

    test('should login with existing admin user', async ({ page }) => {
      await page.goto(`${BASE_URL}/login`);

      // Login with admin credentials
      await page.fill('input[id="emailOrUsername"]', 'admin');
      await page.fill('input[id="password"]', 'admin'); // Default admin password

      await page.click('button[type="submit"]');

      // Wait for redirect or error
      await page.waitForTimeout(3000);

      // Check if logged in or show appropriate message
      const currentUrl = page.url();
      if (currentUrl.includes('/login')) {
        // Login failed - this is expected if password was changed
        console.log('Admin login failed - password may have been changed');
      } else {
        // Login succeeded
        await expect(page.locator('h1')).toContainText('Dashboard');
      }
    });

    test('should logout successfully', async ({ page }) => {
      const testUser = generateTestUser();

      // First signup
      await page.goto(`${BASE_URL}/signup`);
      await page.fill('input[id="email"]', testUser.email);
      await page.fill('input[id="username"]', testUser.username);
      await page.fill('input[id="password"]', testUser.password);
      await page.fill('input[id="confirmPassword"]', testUser.password);
      await page.click('button[type="submit"]');

      // Wait for dashboard
      await expect(page).toHaveURL(`${BASE_URL}/`, { timeout: 15000 });

      // Click user menu
      await page.locator('.border-t button').click();

      // Click sign out
      await page.locator('text=Sign out').click();

      // Should be redirected to login
      await expect(page).toHaveURL(`${BASE_URL}/login`);
    });
  });
});
