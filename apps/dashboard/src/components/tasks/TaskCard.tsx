import { clsx } from 'clsx';
import { Play, Square, Clock, CheckCircle, XCircle, AlertCircle, Loader2 } from 'lucide-react';
import type { Task } from '@cda/shared';

interface TaskCardProps {
  task: Task;
  onExecute?: (id: string) => void;
  onCancel?: (id: string) => void;
  onClick?: (task: Task) => void;
}

const statusConfig: Record<string, { icon: typeof CheckCircle; color: string; label: string }> = {
  pending: { icon: Clock, color: 'text-yellow-500', label: 'Pending' },
  queued: { icon: Clock, color: 'text-blue-500', label: 'Queued' },
  executing: { icon: Loader2, color: 'text-blue-500', label: 'Executing' },
  awaiting_approval: { icon: AlertCircle, color: 'text-orange-500', label: 'Awaiting Approval' },
  completed: { icon: CheckCircle, color: 'text-green-500', label: 'Completed' },
  failed: { icon: XCircle, color: 'text-red-500', label: 'Failed' },
  blocked: { icon: AlertCircle, color: 'text-orange-500', label: 'Blocked' },
  cancelled: { icon: Square, color: 'text-gray-500', label: 'Cancelled' },
};

const typeColors: Record<string, string> = {
  development: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  'bug-fix': 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  deployment: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  configuration: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  documentation: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200',
  testing: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  infrastructure: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200',
  maintenance: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
};

export function TaskCard({ task, onExecute, onCancel, onClick }: TaskCardProps) {
  const status = statusConfig[task.status] || statusConfig.pending;
  const StatusIcon = status.icon;
  const isRunning = task.status === 'executing';
  const canExecute = task.status === 'pending' || task.status === 'failed';
  const canCancel = task.status === 'executing' || task.status === 'queued';

  return (
    <div
      className={clsx(
        'rounded-lg border border-border bg-card p-4 transition-shadow hover:shadow-md',
        onClick && 'cursor-pointer'
      )}
      onClick={() => onClick?.(task)}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <span className={clsx('px-2 py-0.5 rounded-full text-xs font-medium', typeColors[task.type])}>
              {task.type}
            </span>
            <span className="text-xs text-muted-foreground">#{task.id.slice(0, 8)}</span>
          </div>
          <h3 className="font-medium text-foreground truncate">{task.title}</h3>
          {task.description && (
            <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{task.description}</p>
          )}
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className={clsx('flex items-center gap-1', status.color)}>
            <StatusIcon className={clsx('h-4 w-4', isRunning && 'animate-spin')} />
            <span className="text-xs font-medium">{status.label}</span>
          </div>
          <div className="flex gap-1">
            {canExecute && onExecute && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onExecute(task.id);
                }}
                className="p-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                title="Execute"
              >
                <Play className="h-4 w-4" />
              </button>
            )}
            {canCancel && onCancel && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onCancel(task.id);
                }}
                className="p-1.5 rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
                title="Cancel"
              >
                <Square className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
        <span>Priority: {task.priority}</span>
        {task.estimatedDuration && <span>Est: {task.estimatedDuration}</span>}
        {task.requiredTools.length > 0 && (
          <span className="truncate">Tools: {task.requiredTools.join(', ')}</span>
        )}
      </div>
    </div>
  );
}
