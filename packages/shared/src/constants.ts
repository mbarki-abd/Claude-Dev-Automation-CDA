// Task Constants
export const TASK_TYPES = [
  'development',
  'bug-fix',
  'deployment',
  'configuration',
  'documentation',
  'testing',
  'infrastructure',
  'maintenance',
] as const;

export const TASK_STATUSES = [
  'pending',
  'queued',
  'executing',
  'awaiting_approval',
  'completed',
  'failed',
  'blocked',
  'cancelled',
] as const;

export const TASK_COMPLEXITIES = ['low', 'medium', 'high', 'critical'] as const;

// Tool Categories
export const DEVELOPMENT_TOOLS = ['claude', 'git', 'gh', 'node', 'npm', 'pnpm', 'python', 'pip', 'go'] as const;
export const CLOUD_TOOLS = ['gcloud', 'hcloud', 'aws', 'az'] as const;
export const INFRASTRUCTURE_TOOLS = ['docker', 'kubectl', 'terraform', 'ansible', 'helm'] as const;
export const REMOTE_TOOLS = ['ssh', 'scp', 'rsync'] as const;
export const UTILITY_TOOLS = ['jq', 'yq', 'curl', 'wget', 'htop'] as const;

export const ALL_TOOLS = [
  ...DEVELOPMENT_TOOLS,
  ...CLOUD_TOOLS,
  ...INFRASTRUCTURE_TOOLS,
  ...REMOTE_TOOLS,
  ...UTILITY_TOOLS,
] as const;

// Required Tools by Task Type
export const TOOLS_BY_TASK_TYPE: Record<string, string[]> = {
  development: ['claude', 'git', 'gh'],
  'bug-fix': ['claude', 'git'],
  deployment: ['gcloud', 'hcloud', 'ssh', 'docker'],
  configuration: ['ssh', 'ansible', 'terraform'],
  documentation: ['claude', 'git'],
  testing: ['claude', 'docker'],
  infrastructure: ['terraform', 'gcloud', 'hcloud'],
  maintenance: ['ssh', 'docker', 'kubectl'],
};

// MCP Server Definitions
export const MCP_SERVERS = {
  github: {
    name: 'GitHub',
    description: 'GitHub operations',
    requiredSecrets: ['GITHUB_TOKEN'],
  },
  filesystem: {
    name: 'Filesystem',
    description: 'File system access',
    requiredSecrets: [],
  },
  ssh: {
    name: 'SSH',
    description: 'Remote server access',
    requiredSecrets: ['SSH_PRIVATE_KEY'],
  },
  gcloud: {
    name: 'Google Cloud',
    description: 'Google Cloud operations',
    requiredSecrets: ['GOOGLE_APPLICATION_CREDENTIALS'],
  },
  hetzner: {
    name: 'Hetzner Cloud',
    description: 'Hetzner Cloud operations',
    requiredSecrets: ['HETZNER_API_TOKEN'],
  },
  docker: {
    name: 'Docker',
    description: 'Container management',
    requiredSecrets: ['DOCKER_HOST'],
  },
  kubernetes: {
    name: 'Kubernetes',
    description: 'K8s cluster management',
    requiredSecrets: ['KUBECONFIG'],
  },
  database: {
    name: 'Database',
    description: 'Database operations',
    requiredSecrets: ['DB_CONNECTION_STRING'],
  },
} as const;

// Planner Status Mapping
export const PLANNER_STATUS_MAP = {
  notStarted: 'pending',
  inProgress: 'executing',
  completed: 'completed',
} as const;

export const CDA_TO_PLANNER_STATUS = {
  pending: 0,
  queued: 0,
  executing: 50,
  awaiting_approval: 50,
  completed: 100,
  failed: 50,
  blocked: 50,
  cancelled: 0,
} as const;

// WebSocket Events
export const WS_EVENTS = {
  // Server to Client
  TASK_STARTED: 'task:started',
  TASK_OUTPUT: 'task:output',
  TASK_COMPLETED: 'task:completed',
  TASK_FAILED: 'task:failed',
  TASK_UPDATE: 'task:update',
  PROPOSAL_CREATED: 'proposal:created',
  PROPOSAL_RESOLVED: 'proposal:resolved',
  SYNC_UPDATE: 'sync:update',

  // Terminal Events (Server to Client)
  TERMINAL_OUTPUT: 'terminal:output',
  TERMINAL_ERROR: 'terminal:error',
  TERMINAL_EXIT: 'terminal:exit',
  TERMINAL_STARTED: 'terminal:started',

  // Client to Server
  TASK_CANCEL: 'task:cancel',
  PROPOSAL_RESOLVE: 'proposal:resolve',
  TERMINAL_RESIZE: 'terminal:resize',
  TERMINAL_START: 'terminal:start',
  TERMINAL_KILL: 'terminal:kill',
  TERMINAL_INPUT: 'terminal:input',
  SYNC_TRIGGER: 'sync:trigger',
} as const;

// Default Settings
export const DEFAULT_SETTINGS = {
  planner: {
    connected: false,
    syncInterval: 60000, // 1 minute
    autoSync: true,
  },
  execution: {
    timeout: 3600000, // 1 hour
    maxConcurrent: 3,
    autoRetry: true,
    retryCount: 2,
  },
  notifications: {
    enabled: true,
  },
} as const;

// API Routes
export const API_ROUTES = {
  TASKS: '/api/tasks',
  EXECUTIONS: '/api/executions',
  PROPOSALS: '/api/proposals',
  PLANNER: '/api/planner',
  SETTINGS: '/api/settings',
  HEALTH: '/api/health',
} as const;

// Error Codes
export const ERROR_CODES = {
  // General
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',

  // Task
  TASK_NOT_FOUND: 'TASK_NOT_FOUND',
  TASK_ALREADY_RUNNING: 'TASK_ALREADY_RUNNING',
  TASK_CANNOT_CANCEL: 'TASK_CANNOT_CANCEL',

  // Execution
  EXECUTION_TIMEOUT: 'EXECUTION_TIMEOUT',
  EXECUTION_FAILED: 'EXECUTION_FAILED',
  CONTAINER_ERROR: 'CONTAINER_ERROR',

  // Planner
  PLANNER_NOT_CONNECTED: 'PLANNER_NOT_CONNECTED',
  PLANNER_SYNC_FAILED: 'PLANNER_SYNC_FAILED',
  PLANNER_AUTH_FAILED: 'PLANNER_AUTH_FAILED',

  // Proposal
  PROPOSAL_NOT_FOUND: 'PROPOSAL_NOT_FOUND',
  PROPOSAL_ALREADY_RESOLVED: 'PROPOSAL_ALREADY_RESOLVED',
  INVALID_OPTION: 'INVALID_OPTION',
} as const;
