# Claude Dev Automation (CDA) - Test Suite

This directory contains the test suite for the Claude Dev Automation project, focusing on end-to-end (E2E) testing using Playwright.

## Project Overview

Claude Dev Automation (CDA) is a cloud-native web service that orchestrates development tasks from Microsoft Planner using Claude Code Terminal as the execution engine. It provides AI-powered task execution with real-time monitoring and proposal systems.

## Test Structure

```
tests/
└── e2e/                    # End-to-end tests with Playwright
    ├── api.spec.ts         # API endpoint tests
    └── dashboard.spec.ts   # Dashboard UI tests
```

## Testing Framework

- **Playwright**: Modern E2E testing framework for web applications
- **TypeScript**: Type-safe test development
- **Cross-browser**: Tests run on Chromium, Firefox, and WebKit

## Available Test Commands

```bash
# Run all E2E tests
pnpm test:e2e

# Run tests with interactive UI
pnpm test:e2e:ui

# Run tests with visible browser (headed mode)
pnpm test:e2e:headed

# Run all tests (includes E2E)
pnpm test
```

## Test Categories

### API Tests (`e2e/api.spec.ts`)
- Health check endpoints
- Task CRUD operations
- Task execution workflows
- Authentication flows
- Error handling

### Dashboard Tests (`e2e/dashboard.spec.ts`)
- UI component rendering
- Navigation flows
- Real-time updates
- Form interactions
- Responsive design

## Test Configuration

Test configuration is managed through:
- `playwright.config.ts` - Main Playwright configuration
- `playwright.docker.config.ts` - Docker-specific configuration

## Prerequisites for Running Tests

### Development Environment
```bash
# Install dependencies
pnpm install

# Start services
pnpm dev
```

### Required Services
- API Server (http://localhost:3000)
- Dashboard (http://localhost:5173)
- PostgreSQL database
- Redis cache

### Optional Services
- Claude Code Terminal (authenticated)
- Microsoft 365/Planner integration

## Environment Setup

Ensure the following environment variables are configured:

```env
# API Configuration
PORT=3000
NODE_ENV=development

# Database
DATABASE_URL=postgresql://cda:cda@localhost:5432/cda
REDIS_URL=redis://localhost:6379

# Claude Code (for integration tests)
CLAUDE_CODE_AUTH=claude-ai
CLAUDE_CODE_MODEL=claude-sonnet-4-20250514

# Microsoft 365 (for Planner tests)
AZURE_CLIENT_ID=your-client-id
AZURE_CLIENT_SECRET=your-client-secret
PLANNER_PLAN_ID=your-plan-id
```

## Test Data Management

- Tests use isolated test data when possible
- Database cleanup is handled automatically
- Mock services are used for external dependencies

## Adding New Tests

### API Tests
1. Add test cases to `e2e/api.spec.ts`
2. Use Playwright's request fixtures for HTTP testing
3. Test both success and error scenarios
4. Verify response schemas

### UI Tests
1. Add test cases to `e2e/dashboard.spec.ts`
2. Use Playwright's page fixtures for browser automation
3. Test user interactions and workflows
4. Verify visual elements and accessibility

### Best Practices
- Use descriptive test names
- Group related tests with `describe` blocks
- Use proper assertions and error messages
- Clean up test data after each test
- Use page object pattern for complex UI interactions

## Continuous Integration

Tests are designed to run in CI/CD environments:
- Docker support for isolated testing
- Parallel test execution
- Artifact collection for debugging
- Test reporting integration

## Debugging Tests

```bash
# Run specific test file
npx playwright test api.spec.ts

# Run with debug mode
npx playwright test --debug

# Generate test report
npx playwright show-report
```

## Architecture Integration

The test suite validates the integration between:

```
Dashboard (React) ←→ API Server (Fastify) ←→ Claude Code Terminal
                                ↓
                    PostgreSQL + Redis + Planner
```

## Related Documentation

- [Main Project README](../README.md)
- [Playwright Documentation](https://playwright.dev/)
- [API Documentation](../apps/api/)
- [Dashboard Documentation](../apps/dashboard/)

## Contributing

When contributing tests:
1. Follow existing test patterns
2. Add both positive and negative test cases
3. Update this README if adding new test categories
4. Ensure tests pass in all supported browsers
5. Add appropriate test documentation