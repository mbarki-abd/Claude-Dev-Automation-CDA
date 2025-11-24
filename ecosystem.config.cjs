// PM2 Ecosystem Configuration for Native Deployment
module.exports = {
  apps: [
    {
      // API Application
      name: 'cda-api',
      script: './apps/api/dist/index.js',
      cwd: '/root/CDA',
      instances: 2,
      exec_mode: 'cluster',

      // Environment variables
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        DATABASE_URL: 'postgresql://postgres:${POSTGRES_PASSWORD}@localhost:5432/cda',
        REDIS_URL: 'redis://localhost:6379',
        WORKSPACE_DIR: '/root/claude-workspace',
        CLAUDE_CODE_PATH: 'claude',
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      },

      // Logging
      error_file: '/root/CDA/logs/api-error.log',
      out_file: '/root/CDA/logs/api-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,

      // Process management
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      min_uptime: '10s',
      max_restarts: 10,

      // Graceful shutdown
      kill_timeout: 5000,
      listen_timeout: 3000,
      shutdown_with_message: true,
    }
  ],

  deploy: {
    production: {
      user: 'root',
      host: '78.47.138.194',
      ref: 'origin/main',
      repo: 'git@github.com:your-org/cda.git',
      path: '/root/CDA',
      'post-deploy': 'pnpm install && pnpm run build:all && pm2 reload ecosystem.config.js --update-env',
    }
  }
};
