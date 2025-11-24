import { useEffect, useState } from 'react';
import { FileText, Clock, CheckCircle, XCircle, Play, RefreshCw, Search, Filter, Terminal, Settings, Zap, Database } from 'lucide-react';
import { executionsApi, tasksApi, systemLogsApi } from '../services/api';
import type { Execution, Task, SystemLog } from '@cda/shared';

interface ExecutionWithTask extends Execution {
  taskTitle?: string;
}

type LogTab = 'claude-code' | 'system';

export function Logs() {
  const [activeTab, setActiveTab] = useState<LogTab>('claude-code');
  const [executions, setExecutions] = useState<ExecutionWithTask[]>([]);
  const [systemLogs, setSystemLogs] = useState<SystemLog[]>([]);
  const [_tasks, setTasks] = useState<Record<string, Task>>({});
  const [loading, setLoading] = useState(true);
  const [selectedExecution, setSelectedExecution] = useState<ExecutionWithTask | null>(null);
  const [selectedSystemLog, setSelectedSystemLog] = useState<SystemLog | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');

  const fetchClaudeCodeLogs = async () => {
    setLoading(true);
    try {
      const [execResponse, tasksResponse] = await Promise.all([
        executionsApi.list({ limit: 50 }),
        tasksApi.list({ limit: 100 }),
      ]);

      const tasksMap: Record<string, Task> = {};
      (tasksResponse.data || []).forEach((task) => {
        tasksMap[task.id] = task;
      });
      setTasks(tasksMap);

      const executionsWithTasks = (execResponse.data || []).map((exec) => ({
        ...exec,
        taskTitle: tasksMap[exec.taskId]?.title || 'Unknown Task',
      }));
      setExecutions(executionsWithTasks);
    } catch (error) {
      console.error('Failed to fetch Claude Code logs:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchSystemLogs = async () => {
    setLoading(true);
    try {
      const response = await systemLogsApi.list({ limit: 100 });
      setSystemLogs(response.data || []);
    } catch (error) {
      console.error('Failed to fetch system logs:', error);
      // Use mock data if API not available
      setSystemLogs([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchData = async () => {
    if (activeTab === 'claude-code') {
      await fetchClaudeCodeLogs();
    } else {
      await fetchSystemLogs();
    }
  };

  useEffect(() => {
    fetchData();
  }, [activeTab]);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
      case 'success':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'failed':
      case 'error':
        return <XCircle className="h-4 w-4 text-red-500" />;
      case 'running':
        return <Play className="h-4 w-4 text-blue-500 animate-pulse" />;
      default:
        return <Clock className="h-4 w-4 text-yellow-500" />;
    }
  };

  const getStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      completed: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
      success: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
      failed: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
      error: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
      running: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
      pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
      info: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
      warning: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
    };
    return colors[status] || 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-400';
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'planner':
        return <Database className="h-4 w-4 text-purple-500" />;
      case 'api':
        return <Zap className="h-4 w-4 text-blue-500" />;
      case 'execution':
        return <Terminal className="h-4 w-4 text-green-500" />;
      case 'system':
        return <Settings className="h-4 w-4 text-gray-500" />;
      default:
        return <FileText className="h-4 w-4 text-gray-500" />;
    }
  };

  const formatDuration = (ms?: number | null) => {
    if (!ms) return '-';
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  };

  const formatDate = (date: string | Date) => {
    return new Date(date).toLocaleString();
  };

  const filteredExecutions = executions.filter((exec) => {
    if (statusFilter && exec.status !== statusFilter) return false;
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        exec.taskTitle?.toLowerCase().includes(query) ||
        exec.id.toLowerCase().includes(query) ||
        exec.output?.toLowerCase().includes(query)
      );
    }
    return true;
  });

  const filteredSystemLogs = systemLogs.filter((log) => {
    if (categoryFilter && log.category !== categoryFilter) return false;
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        log.message.toLowerCase().includes(query) ||
        log.source?.toLowerCase().includes(query) ||
        log.details?.toLowerCase().includes(query)
      );
    }
    return true;
  });

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <FileText className="h-6 w-6" />
            Logs
          </h1>
          <p className="text-muted-foreground">View execution and system logs</p>
        </div>
        <button
          onClick={fetchData}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6 border-b border-border">
        <button
          onClick={() => setActiveTab('claude-code')}
          className={`flex items-center gap-2 px-4 py-2 font-medium transition-colors border-b-2 -mb-px ${
            activeTab === 'claude-code'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <Terminal className="h-4 w-4" />
          Claude Code Logs
        </button>
        <button
          onClick={() => setActiveTab('system')}
          className={`flex items-center gap-2 px-4 py-2 font-medium transition-colors border-b-2 -mb-px ${
            activeTab === 'system'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <Settings className="h-4 w-4" />
          System Logs
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-4 mb-6">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder={activeTab === 'claude-code' ? 'Search executions...' : 'Search system logs...'}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        {activeTab === 'claude-code' ? (
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="pl-10 pr-8 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary appearance-none"
            >
              <option value="">All Status</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
              <option value="running">Running</option>
              <option value="pending">Pending</option>
            </select>
          </div>
        ) : (
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="pl-10 pr-8 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary appearance-none"
            >
              <option value="">All Categories</option>
              <option value="planner">Planner Sync</option>
              <option value="api">API</option>
              <option value="execution">Execution</option>
              <option value="system">System</option>
            </select>
          </div>
        )}
      </div>

      {/* Claude Code Logs Tab */}
      {activeTab === 'claude-code' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Executions List */}
          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <div className="p-4 border-b border-border bg-muted/50">
              <h2 className="font-semibold flex items-center gap-2">
                <Terminal className="h-4 w-4" />
                Claude Code Executions ({filteredExecutions.length})
              </h2>
            </div>
            <div className="max-h-[600px] overflow-y-auto">
              {loading ? (
                <div className="p-8 text-center text-muted-foreground">Loading...</div>
              ) : filteredExecutions.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">No executions found</div>
              ) : (
                <div className="divide-y divide-border">
                  {filteredExecutions.map((exec) => (
                    <button
                      key={exec.id}
                      onClick={() => setSelectedExecution(exec)}
                      className={`w-full p-4 text-left hover:bg-muted/50 transition-colors ${
                        selectedExecution?.id === exec.id ? 'bg-muted' : ''
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            {getStatusIcon(exec.status)}
                            <span className="font-medium truncate">{exec.taskTitle}</span>
                          </div>
                          <div className="text-xs text-muted-foreground mt-1">
                            ID: {exec.id.slice(0, 8)}...
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <span className={`inline-block px-2 py-0.5 text-xs rounded-full ${getStatusBadge(exec.status)}`}>
                            {exec.status}
                          </span>
                          <div className="text-xs text-muted-foreground mt-1">
                            {formatDuration(exec.durationMs)}
                          </div>
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground mt-2">
                        {formatDate(exec.startedAt)}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Execution Details */}
          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <div className="p-4 border-b border-border bg-muted/50">
              <h2 className="font-semibold">Execution Details</h2>
            </div>
            {selectedExecution ? (
              <div className="p-4 space-y-4">
                {/* Metadata */}
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Task:</span>
                    <p className="font-medium">{selectedExecution.taskTitle}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Status:</span>
                    <p className={`font-medium ${getStatusBadge(selectedExecution.status)} inline-block px-2 py-0.5 rounded-full mt-1`}>
                      {selectedExecution.status}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Started:</span>
                    <p className="font-medium">{formatDate(selectedExecution.startedAt)}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Duration:</span>
                    <p className="font-medium">{formatDuration(selectedExecution.durationMs)}</p>
                  </div>
                  {selectedExecution.exitCode !== undefined && selectedExecution.exitCode !== null && (
                    <div>
                      <span className="text-muted-foreground">Exit Code:</span>
                      <p className={`font-medium ${selectedExecution.exitCode === 0 ? 'text-green-500' : 'text-red-500'}`}>
                        {selectedExecution.exitCode}
                      </p>
                    </div>
                  )}
                  <div>
                    <span className="text-muted-foreground">Execution ID:</span>
                    <p className="font-mono text-xs">{selectedExecution.id}</p>
                  </div>
                </div>

                {/* Output */}
                {selectedExecution.output && (
                  <div>
                    <h3 className="font-semibold mb-2 flex items-center gap-2">
                      <FileText className="h-4 w-4" />
                      Output
                    </h3>
                    <div className="rounded-lg bg-black p-4 max-h-[300px] overflow-y-auto">
                      <pre className="text-green-400 font-mono text-xs whitespace-pre-wrap">
                        {selectedExecution.output}
                      </pre>
                    </div>
                  </div>
                )}

                {/* Error */}
                {selectedExecution.error && (
                  <div>
                    <h3 className="font-semibold mb-2 text-red-500 flex items-center gap-2">
                      <XCircle className="h-4 w-4" />
                      Error
                    </h3>
                    <div className="rounded-lg bg-red-950/20 border border-red-500/30 p-4 max-h-[200px] overflow-y-auto">
                      <pre className="text-red-400 font-mono text-xs whitespace-pre-wrap">
                        {selectedExecution.error}
                      </pre>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-8 text-center text-muted-foreground">
                Select an execution to view details
              </div>
            )}
          </div>
        </div>
      )}

      {/* System Logs Tab */}
      {activeTab === 'system' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* System Logs List */}
          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <div className="p-4 border-b border-border bg-muted/50">
              <h2 className="font-semibold flex items-center gap-2">
                <Settings className="h-4 w-4" />
                System Events ({filteredSystemLogs.length})
              </h2>
            </div>
            <div className="max-h-[600px] overflow-y-auto">
              {loading ? (
                <div className="p-8 text-center text-muted-foreground">Loading...</div>
              ) : filteredSystemLogs.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">
                  <p>No system logs found</p>
                  <p className="text-sm mt-2">System logs will appear here as actions occur</p>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {filteredSystemLogs.map((log) => (
                    <button
                      key={log.id}
                      onClick={() => setSelectedSystemLog(log)}
                      className={`w-full p-4 text-left hover:bg-muted/50 transition-colors ${
                        selectedSystemLog?.id === log.id ? 'bg-muted' : ''
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            {getCategoryIcon(log.category)}
                            <span className="font-medium truncate">{log.message}</span>
                          </div>
                          <div className="text-xs text-muted-foreground mt-1">
                            {log.source}
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <span className={`inline-block px-2 py-0.5 text-xs rounded-full ${getStatusBadge(log.level)}`}>
                            {log.level}
                          </span>
                          <div className="text-xs text-muted-foreground mt-1">
                            {log.category}
                          </div>
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground mt-2">
                        {formatDate(log.timestamp)}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* System Log Details */}
          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <div className="p-4 border-b border-border bg-muted/50">
              <h2 className="font-semibold">Log Details</h2>
            </div>
            {selectedSystemLog ? (
              <div className="p-4 space-y-4">
                {/* Metadata */}
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Message:</span>
                    <p className="font-medium">{selectedSystemLog.message}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Level:</span>
                    <p className={`font-medium ${getStatusBadge(selectedSystemLog.level)} inline-block px-2 py-0.5 rounded-full mt-1`}>
                      {selectedSystemLog.level}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Category:</span>
                    <p className="font-medium flex items-center gap-2">
                      {getCategoryIcon(selectedSystemLog.category)}
                      {selectedSystemLog.category}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Source:</span>
                    <p className="font-medium">{selectedSystemLog.source}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Timestamp:</span>
                    <p className="font-medium">{formatDate(selectedSystemLog.timestamp)}</p>
                  </div>
                  {selectedSystemLog.taskId && (
                    <div>
                      <span className="text-muted-foreground">Task ID:</span>
                      <p className="font-mono text-xs">{selectedSystemLog.taskId}</p>
                    </div>
                  )}
                </div>

                {/* Details */}
                {selectedSystemLog.details && (
                  <div>
                    <h3 className="font-semibold mb-2 flex items-center gap-2">
                      <FileText className="h-4 w-4" />
                      Details
                    </h3>
                    <div className="rounded-lg bg-muted p-4 max-h-[300px] overflow-y-auto">
                      <pre className="font-mono text-xs whitespace-pre-wrap">
                        {selectedSystemLog.details}
                      </pre>
                    </div>
                  </div>
                )}

                {/* Metadata */}
                {selectedSystemLog.metadata && Object.keys(selectedSystemLog.metadata).length > 0 && (
                  <div>
                    <h3 className="font-semibold mb-2 flex items-center gap-2">
                      <Database className="h-4 w-4" />
                      Metadata
                    </h3>
                    <div className="rounded-lg bg-muted p-4 max-h-[200px] overflow-y-auto">
                      <pre className="font-mono text-xs whitespace-pre-wrap">
                        {JSON.stringify(selectedSystemLog.metadata, null, 2)}
                      </pre>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-8 text-center text-muted-foreground">
                Select a log entry to view details
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
