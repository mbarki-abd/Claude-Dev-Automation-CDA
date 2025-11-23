import { test, expect } from '@playwright/test';

const API_URL = 'http://localhost:3000';

test.describe('API Health', () => {
  test('should return health status', async ({ request }) => {
    const response = await request.get(`${API_URL}/api/health`);

    expect(response.ok()).toBeTruthy();

    const body = await response.json();
    expect(body).toHaveProperty('status');
    expect(body).toHaveProperty('timestamp');
    expect(body).toHaveProperty('version');
    expect(body).toHaveProperty('uptime');
  });

  test('should return live status', async ({ request }) => {
    const response = await request.get(`${API_URL}/api/health/live`);

    expect(response.ok()).toBeTruthy();

    const body = await response.json();
    expect(body.status).toBe('ok');
  });

  test('should return ready status', async ({ request }) => {
    const response = await request.get(`${API_URL}/api/health/ready`);

    expect(response.ok()).toBeTruthy();

    const body = await response.json();
    expect(body).toHaveProperty('status');
    expect(body).toHaveProperty('checks');
  });
});

test.describe('API Tasks', () => {
  test('should list tasks', async ({ request }) => {
    const response = await request.get(`${API_URL}/api/tasks`);

    expect(response.ok()).toBeTruthy();

    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body).toHaveProperty('data');
    expect(Array.isArray(body.data)).toBe(true);
  });

  test('should return 404 for non-existent task', async ({ request }) => {
    const response = await request.get(`${API_URL}/api/tasks/00000000-0000-0000-0000-000000000000`);

    expect(response.status()).toBe(404);

    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('TASK_NOT_FOUND');
  });

  test('should create and delete a task', async ({ request }) => {
    // Create task
    const createResponse = await request.post(`${API_URL}/api/tasks`, {
      data: {
        title: 'Test Task from Playwright',
        description: 'This is a test task created by Playwright',
        type: 'testing',
        priority: 5,
      },
    });

    expect(createResponse.status()).toBe(201);

    const createBody = await createResponse.json();
    expect(createBody.success).toBe(true);
    expect(createBody.data.title).toBe('Test Task from Playwright');
    expect(createBody.data.status).toBe('pending');

    const taskId = createBody.data.id;

    // Delete task
    const deleteResponse = await request.delete(`${API_URL}/api/tasks/${taskId}`);

    expect(deleteResponse.ok()).toBeTruthy();

    const deleteBody = await deleteResponse.json();
    expect(deleteBody.success).toBe(true);
    expect(deleteBody.data.deleted).toBe(true);
  });

  test('should update a task', async ({ request }) => {
    // Create task first
    const createResponse = await request.post(`${API_URL}/api/tasks`, {
      data: {
        title: 'Task to Update',
        type: 'development',
      },
    });

    const { data: task } = await createResponse.json();

    // Update task
    const updateResponse = await request.patch(`${API_URL}/api/tasks/${task.id}`, {
      data: {
        title: 'Updated Task Title',
        priority: 1,
      },
    });

    expect(updateResponse.ok()).toBeTruthy();

    const updateBody = await updateResponse.json();
    expect(updateBody.data.title).toBe('Updated Task Title');
    expect(updateBody.data.priority).toBe(1);

    // Cleanup
    await request.delete(`${API_URL}/api/tasks/${task.id}`);
  });

  test('should get task stats', async ({ request }) => {
    const response = await request.get(`${API_URL}/api/tasks/stats`);

    expect(response.ok()).toBeTruthy();

    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveProperty('total');
    expect(body.data).toHaveProperty('byStatus');
    expect(body.data).toHaveProperty('byType');
  });
});

test.describe('API Executions', () => {
  test('should list executions', async ({ request }) => {
    const response = await request.get(`${API_URL}/api/executions`);

    expect(response.ok()).toBeTruthy();

    const body = await response.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });
});

test.describe('API Proposals', () => {
  test('should list proposals', async ({ request }) => {
    const response = await request.get(`${API_URL}/api/proposals`);

    expect(response.ok()).toBeTruthy();

    const body = await response.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  test('should list pending proposals', async ({ request }) => {
    const response = await request.get(`${API_URL}/api/proposals/pending`);

    expect(response.ok()).toBeTruthy();

    const body = await response.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });
});
