// Task Types
export type TaskType =
  | 'development'
  | 'bug-fix'
  | 'deployment'
  | 'configuration'
  | 'documentation'
  | 'testing'
  | 'infrastructure'
  | 'maintenance';

export type TaskStatus =
  | 'pending'
  | 'queued'
  | 'executing'
  | 'awaiting_approval'
  | 'completed'
  | 'failed'
  | 'blocked'
  | 'cancelled';

export type TaskComplexity = 'low' | 'medium' | 'high' | 'critical';

export interface Task {
  id: string;
  plannerId?: string;
  title: string;
  description?: string;
  type: TaskType;
  status: TaskStatus;
  priority: number;
  complexity?: TaskComplexity;
  estimatedDuration?: string;
  interpretation?: TaskInterpretation;
  executionPlan?: string[];
  requiredTools: string[];
  mcpServers: string[];
  prerequisites?: Record<string, unknown>;
  plannerBucket?: string;
  plannerLabels?: string[];
  assignedTo?: string;
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

export interface TaskInterpretation {
  taskId: string;
  type: TaskType;
  complexity: TaskComplexity;
  estimatedDuration: string;
  requirements: string[];
  prerequisites: string[];
  tools: string[];
  mcpServers: string[];
  executionPlan: string[];
  risks: string[];
  blockers: string[];
}

// Execution Types
export type ExecutionStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timeout';

export interface Execution {
  id: string;
  taskId: string;
  status: ExecutionStatus;
  containerId?: string;
  output?: string;
  error?: string;
  exitCode?: number;
  durationMs?: number;
  artifacts?: Record<string, unknown>;
  startedAt: Date;
  completedAt?: Date;
}

export interface ExecutionLog {
  id: string;
  executionId: string;
  timestamp: Date;
  stream: 'stdout' | 'stderr';
  data: string;
}

// System Log Types
export type SystemLogLevel = 'info' | 'warning' | 'error' | 'success';
export type SystemLogCategory = 'planner' | 'api' | 'execution' | 'system';

export interface SystemLog {
  id: string;
  level: SystemLogLevel;
  category: SystemLogCategory;
  source: string;
  message: string;
  details?: string;
  taskId?: string;
  metadata?: Record<string, unknown>;
  timestamp: Date;
}

// Proposal Types
export type ProposalType =
  | 'implementation'
  | 'architecture'
  | 'dependency'
  | 'deployment'
  | 'blocker'
  | 'error'
  | 'cost';

export type ProposalStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export interface ProposalOption {
  id: string;
  name: string;
  description: string;
  pros: string[];
  cons: string[];
}

export interface Proposal {
  id: string;
  taskId: string;
  executionId?: string;
  type: ProposalType;
  title: string;
  description?: string;
  options: ProposalOption[];
  recommendation?: string;
  status: ProposalStatus;
  resolution?: string;
  resolvedBy?: string;
  createdAt: Date;
  resolvedAt?: Date;
}

// Planner Types
export type PlannerTaskStatus = 'notStarted' | 'inProgress' | 'completed';

export interface PlannerTask {
  id: string;
  planId: string;
  bucketId: string;
  title: string;
  percentComplete: number;
  startDateTime?: string;
  dueDateTime?: string;
  assigneePriority?: string;
  orderHint?: string;
  createdDateTime: string;
  createdBy?: {
    user?: {
      id: string;
      displayName?: string;
    };
  };
  assignments?: Record<string, unknown>;
  appliedCategories?: Record<string, boolean>;
}

export interface PlannerTaskDetails {
  id: string;
  description?: string;
  previewType?: string;
  checklist?: Record<string, {
    isChecked: boolean;
    title: string;
    orderHint?: string;
  }>;
  references?: Record<string, unknown>;
}

// WebSocket Events
export interface WebSocketEvents {
  // Server to Client
  'task:started': { taskId: string; timestamp: Date };
  'task:output': { taskId: string; data: string; stream: 'stdout' | 'stderr' };
  'task:completed': { taskId: string; result: unknown; duration: number };
  'task:failed': { taskId: string; error: string };
  'proposal:created': { proposal: Proposal };
  'sync:update': { tasks: Task[] };

  // Client to Server
  'task:cancel': { taskId: string };
  'proposal:resolve': { proposalId: string; option: string };
  'terminal:resize': { taskId: string; cols: number; rows: number };
  'sync:trigger': Record<string, never>;
}

// MCP Types
export interface MCPServerConfig {
  name: string;
  enabled: boolean;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  requiredSecrets?: string[];
}

export interface MCPConfiguration {
  mcpServers: Record<string, {
    command: string;
    args?: string[];
    env?: Record<string, string>;
  }>;
}

// API Response Types
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
  };
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// Settings Types
export interface Settings {
  planner: {
    connected: boolean;
    planId?: string;
    syncInterval: number;
    autoSync: boolean;
  };
  mcp: {
    servers: MCPServerConfig[];
  };
  notifications: {
    enabled: boolean;
    email?: string;
    webhookUrl?: string;
  };
  execution: {
    timeout: number;
    maxConcurrent: number;
    autoRetry: boolean;
    retryCount: number;
  };
}
