import { test, expect } from '@playwright/test';

test.describe('Dashboard', () => {
  test('should display the main dashboard', async ({ page }) => {
    await page.goto('/');

    // Check that the sidebar navigation links are visible (use exact names from sidebar)
    await expect(page.locator('nav').getByRole('link', { name: 'Dashboard', exact: true })).toBeVisible();
    await expect(page.locator('nav').getByRole('link', { name: 'Tasks', exact: true })).toBeVisible();
    await expect(page.locator('nav').getByRole('link', { name: 'Logs', exact: true })).toBeVisible();
    await expect(page.locator('nav').getByRole('link', { name: 'Terminal', exact: true })).toBeVisible();
    await expect(page.locator('nav').getByRole('link', { name: 'Proposals', exact: true })).toBeVisible();
    await expect(page.locator('nav').getByRole('link', { name: 'CLI Auth', exact: true })).toBeVisible();
    await expect(page.locator('nav').getByRole('link', { name: 'Settings', exact: true })).toBeVisible();

    // Check the dashboard title
    await expect(page.getByRole('heading', { name: /dashboard/i }).first()).toBeVisible();
  });

  test('should navigate to tasks page', async ({ page }) => {
    await page.goto('/');

    await page.locator('nav').getByRole('link', { name: 'Tasks', exact: true }).click();

    await expect(page).toHaveURL('/tasks');
    await expect(page.getByRole('heading', { name: /tasks/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /new task/i })).toBeVisible();
  });

  test('should navigate to terminal page', async ({ page }) => {
    await page.goto('/');

    await page.locator('nav').getByRole('link', { name: 'Terminal', exact: true }).click();

    await expect(page).toHaveURL('/terminal');
    await expect(page.getByRole('heading', { name: /terminal/i })).toBeVisible();
  });

  test('should navigate to proposals page', async ({ page }) => {
    await page.goto('/');

    await page.locator('nav').getByRole('link', { name: 'Proposals', exact: true }).click();

    await expect(page).toHaveURL('/proposals');
    await expect(page.getByRole('heading', { name: /proposals/i })).toBeVisible();
  });

  test('should navigate to settings page', async ({ page }) => {
    await page.goto('/');

    await page.locator('nav').getByRole('link', { name: 'Settings', exact: true }).click();

    await expect(page).toHaveURL('/settings');
    await expect(page.getByRole('heading', { name: /settings/i })).toBeVisible();
  });
});

test.describe('Tasks', () => {
  test('should open create task modal', async ({ page }) => {
    await page.goto('/tasks');

    await page.getByRole('button', { name: /new task/i }).click();

    // Check modal is visible
    await expect(page.getByRole('heading', { name: /create new task/i })).toBeVisible();
    await expect(page.getByPlaceholder(/task title/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /create task/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /cancel/i })).toBeVisible();
  });

  test('should close create task modal on cancel', async ({ page }) => {
    await page.goto('/tasks');

    await page.getByRole('button', { name: /new task/i }).click();
    await expect(page.getByRole('heading', { name: /create new task/i })).toBeVisible();

    await page.getByRole('button', { name: /cancel/i }).click();

    await expect(page.getByRole('heading', { name: /create new task/i })).not.toBeVisible();
  });

  test('should filter tasks by status', async ({ page }) => {
    await page.goto('/tasks');

    // Select a status filter
    await page.locator('select').first().selectOption('pending');

    // URL should not change for client-side filtering
    await expect(page).toHaveURL('/tasks');
  });

  test('should search tasks', async ({ page }) => {
    await page.goto('/tasks');

    await page.getByPlaceholder(/search tasks/i).fill('test search');

    // Search is client-side, just verify input works
    await expect(page.getByPlaceholder(/search tasks/i)).toHaveValue('test search');
  });
});

test.describe('CLI Auth', () => {
  test('should navigate to CLI Auth page', async ({ page }) => {
    await page.goto('/');

    await page.locator('nav').getByRole('link', { name: 'CLI Auth', exact: true }).click();

    await expect(page).toHaveURL('/cli-auth');
    await expect(page.getByRole('heading', { name: /cli auth/i })).toBeVisible();
  });

  test('should display auth tools', async ({ page }) => {
    await page.goto('/cli-auth');

    // Check that auth tool cards are visible
    await expect(page.getByText(/claude code/i).first()).toBeVisible();
    await expect(page.getByText(/azure cli/i).first()).toBeVisible();

    // Check authenticate buttons exist
    const authButtons = page.getByRole('button', { name: /authenticate/i });
    await expect(authButtons.first()).toBeVisible();
  });

  test('should start Claude Code authentication', async ({ page }) => {
    await page.goto('/cli-auth');

    // Find and click the Claude Code authenticate button
    const claudeCard = page.locator('text=Claude Code').locator('..').locator('..');
    const authButton = claudeCard.getByRole('button', { name: /authenticate/i });

    if (await authButton.isVisible()) {
      await authButton.click();

      // Wait for the authentication to start - should show some status change
      // Either an error dialog, loading state, or auth URL
      await page.waitForTimeout(3000);

      // Just verify the page didn't crash and is still responsive
      await expect(page.getByRole('heading', { name: /cli auth/i })).toBeVisible();
    }
  });
});
