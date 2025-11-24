import { useEffect, useState, useRef } from 'react';
import { Terminal as TerminalIcon, FolderTree, Play, RefreshCw, Send, Trash2, Bot } from 'lucide-react';
import { terminalApi } from '../services/api';

interface CommandHistory {
  id: number;
  type: 'command' | 'claude';
  input: string;
  output: string;
  exitCode: number;
  timestamp: Date;
}

interface FolderNode {
  [key: string]: FolderNode | string;
}

export function Terminal() {
  const [command, setCommand] = useState('');
  const [claudePrompt, setClaudePrompt] = useState('');
  const [history, setHistory] = useState<CommandHistory[]>([]);
  const [loading, setLoading] = useState(false);
  const [_workspaceInfo, setWorkspaceInfo] = useState<{ workspaceDir: string; exists: boolean; files: string[] } | null>(null);
  const [folderTree, setFolderTree] = useState<FolderNode | null>(null);
  const [activeTab, setActiveTab] = useState<'console' | 'claude' | 'files'>('console');
  const outputRef = useRef<HTMLDivElement>(null);
  const commandIdRef = useRef(0);

  useEffect(() => {
    fetchWorkspaceInfo();
    fetchFolderTree();
  }, []);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [history]);

  const fetchWorkspaceInfo = async () => {
    try {
      const response = await terminalApi.execute('echo "Workspace ready"', '/workspace');
      if (response.success) {
        setWorkspaceInfo({
          workspaceDir: '/workspace',
          exists: true,
          files: [],
        });
      }
    } catch (error) {
      console.error('Failed to fetch workspace info:', error);
    }
  };

  const fetchFolderTree = async () => {
    try {
      const response = await fetch('/api/terminal/tree');
      const data = await response.json();
      if (data.success) {
        setFolderTree(data.data.tree);
      }
    } catch (error) {
      console.error('Failed to fetch folder tree:', error);
    }
  };

  const executeCommand = async () => {
    if (!command.trim() || loading) return;

    setLoading(true);
    const cmdInput = command;
    setCommand('');

    try {
      const response = await terminalApi.execute(cmdInput, '/workspace');
      const newEntry: CommandHistory = {
        id: commandIdRef.current++,
        type: 'command',
        input: cmdInput,
        output: response.data?.output || '',
        exitCode: response.data?.exitCode || 0,
        timestamp: new Date(),
      };
      setHistory((prev) => [...prev, newEntry]);

      // Refresh folder tree after command
      fetchFolderTree();
    } catch (error: any) {
      const newEntry: CommandHistory = {
        id: commandIdRef.current++,
        type: 'command',
        input: cmdInput,
        output: error.message || 'Command failed',
        exitCode: 1,
        timestamp: new Date(),
      };
      setHistory((prev) => [...prev, newEntry]);
    } finally {
      setLoading(false);
    }
  };

  const executeClaudeCode = async () => {
    if (!claudePrompt.trim() || loading) return;

    setLoading(true);
    const prompt = claudePrompt;
    setClaudePrompt('');

    try {
      const response = await terminalApi.claudeCode(prompt, '/workspace');
      const newEntry: CommandHistory = {
        id: commandIdRef.current++,
        type: 'claude',
        input: prompt,
        output: response.data?.output || '',
        exitCode: response.data?.exitCode || 0,
        timestamp: new Date(),
      };
      setHistory((prev) => [...prev, newEntry]);

      // Refresh folder tree after Claude Code runs
      fetchFolderTree();
    } catch (error: any) {
      const newEntry: CommandHistory = {
        id: commandIdRef.current++,
        type: 'claude',
        input: prompt,
        output: error.message || 'Claude Code failed',
        exitCode: 1,
        timestamp: new Date(),
      };
      setHistory((prev) => [...prev, newEntry]);
    } finally {
      setLoading(false);
    }
  };

  const clearHistory = () => {
    setHistory([]);
  };

  const renderFolderTree = (tree: FolderNode, depth = 0): JSX.Element => {
    return (
      <ul className={`${depth > 0 ? 'ml-4' : ''} space-y-1`}>
        {Object.entries(tree).map(([name, value]) => (
          <li key={name} className="text-sm">
            {typeof value === 'object' ? (
              <>
                <span className="text-blue-400">{name}</span>
                {renderFolderTree(value, depth + 1)}
              </>
            ) : (
              <span className="text-gray-400">{name}</span>
            )}
          </li>
        ))}
      </ul>
    );
  };

  return (
    <div className="p-6 h-full flex flex-col">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <TerminalIcon className="h-6 w-6" />
            Container Terminal
          </h1>
          <p className="text-muted-foreground">
            Execute commands and use Claude Code in the container
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={fetchFolderTree}
            className="flex items-center gap-2 px-3 py-2 bg-secondary text-secondary-foreground rounded-lg hover:bg-secondary/80"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
          <button
            onClick={clearHistory}
            className="flex items-center gap-2 px-3 py-2 bg-secondary text-secondary-foreground rounded-lg hover:bg-secondary/80"
          >
            <Trash2 className="h-4 w-4" />
            Clear
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-4 border-b border-border">
        <button
          onClick={() => setActiveTab('console')}
          className={`flex items-center gap-2 px-4 py-2 font-medium transition-colors border-b-2 -mb-px ${
            activeTab === 'console'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <TerminalIcon className="h-4 w-4" />
          Console
        </button>
        <button
          onClick={() => setActiveTab('claude')}
          className={`flex items-center gap-2 px-4 py-2 font-medium transition-colors border-b-2 -mb-px ${
            activeTab === 'claude'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <Bot className="h-4 w-4" />
          Claude Code
        </button>
        <button
          onClick={() => setActiveTab('files')}
          className={`flex items-center gap-2 px-4 py-2 font-medium transition-colors border-b-2 -mb-px ${
            activeTab === 'files'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <FolderTree className="h-4 w-4" />
          File Explorer
        </button>
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-4 min-h-0">
        {/* Main Content Area */}
        <div className="lg:col-span-2 flex flex-col min-h-0">
          {/* Console Tab */}
          {activeTab === 'console' && (
            <>
              {/* Output Area */}
              <div
                ref={outputRef}
                className="flex-1 rounded-lg bg-black border border-border p-4 font-mono text-sm overflow-y-auto min-h-[400px]"
              >
                {history.length === 0 ? (
                  <div className="text-gray-500">
                    <p>$ Welcome to CDA Container Terminal</p>
                    <p>$ Working directory: /workspace</p>
                    <p>$ Type a command and press Enter to execute</p>
                    <p className="animate-pulse">_</p>
                  </div>
                ) : (
                  history.map((entry) => (
                    <div key={entry.id} className="mb-4">
                      <div className="flex items-center gap-2">
                        {entry.type === 'command' ? (
                          <span className="text-green-400">$</span>
                        ) : (
                          <span className="text-purple-400">[Claude]</span>
                        )}
                        <span className="text-white">{entry.input}</span>
                      </div>
                      <pre
                        className={`mt-1 whitespace-pre-wrap ${
                          entry.exitCode === 0 ? 'text-gray-300' : 'text-red-400'
                        }`}
                      >
                        {entry.output}
                      </pre>
                      {entry.exitCode !== 0 && (
                        <span className="text-red-500 text-xs">Exit code: {entry.exitCode}</span>
                      )}
                    </div>
                  ))
                )}
                {loading && (
                  <div className="flex items-center gap-2 text-yellow-400">
                    <div className="animate-spin h-4 w-4 border-2 border-yellow-400 border-t-transparent rounded-full" />
                    Executing...
                  </div>
                )}
              </div>

              {/* Command Input */}
              <div className="mt-4 flex gap-2">
                <div className="flex-1 relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-green-400 font-mono">$</span>
                  <input
                    type="text"
                    value={command}
                    onChange={(e) => setCommand(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && executeCommand()}
                    placeholder="Enter command..."
                    disabled={loading}
                    className="w-full pl-8 pr-4 py-3 rounded-lg border border-border bg-background font-mono focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
                  />
                </div>
                <button
                  onClick={executeCommand}
                  disabled={loading || !command.trim()}
                  className="flex items-center gap-2 px-4 py-3 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50"
                >
                  <Play className="h-4 w-4" />
                  Run
                </button>
              </div>
            </>
          )}

          {/* Claude Code Tab */}
          {activeTab === 'claude' && (
            <>
              {/* Output Area */}
              <div
                ref={outputRef}
                className="flex-1 rounded-lg bg-black border border-border p-4 font-mono text-sm overflow-y-auto min-h-[400px]"
              >
                {history.filter((h) => h.type === 'claude').length === 0 ? (
                  <div className="text-gray-500">
                    <p className="text-purple-400">[Claude Code Interactive Console]</p>
                    <p>$ Send prompts to Claude Code running in the container</p>
                    <p>$ Claude has access to /workspace and all container tools</p>
                    <p className="animate-pulse">_</p>
                  </div>
                ) : (
                  history
                    .filter((h) => h.type === 'claude')
                    .map((entry) => (
                      <div key={entry.id} className="mb-4">
                        <div className="flex items-start gap-2">
                          <span className="text-purple-400 font-bold">[You]</span>
                          <span className="text-white">{entry.input}</span>
                        </div>
                        <div className="mt-2 flex items-start gap-2">
                          <span className="text-green-400 font-bold">[Claude]</span>
                          <pre
                            className={`whitespace-pre-wrap ${
                              entry.exitCode === 0 ? 'text-gray-300' : 'text-red-400'
                            }`}
                          >
                            {entry.output}
                          </pre>
                        </div>
                      </div>
                    ))
                )}
                {loading && (
                  <div className="flex items-center gap-2 text-purple-400">
                    <div className="animate-spin h-4 w-4 border-2 border-purple-400 border-t-transparent rounded-full" />
                    Claude is thinking...
                  </div>
                )}
              </div>

              {/* Claude Prompt Input */}
              <div className="mt-4">
                <textarea
                  value={claudePrompt}
                  onChange={(e) => setClaudePrompt(e.target.value)}
                  placeholder="Enter your prompt for Claude Code..."
                  disabled={loading}
                  rows={3}
                  className="w-full px-4 py-3 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50 resize-none"
                />
                <div className="mt-2 flex justify-end">
                  <button
                    onClick={executeClaudeCode}
                    disabled={loading || !claudePrompt.trim()}
                    className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
                  >
                    <Send className="h-4 w-4" />
                    Send to Claude
                  </button>
                </div>
              </div>
            </>
          )}

          {/* Files Tab */}
          {activeTab === 'files' && (
            <div className="flex-1 rounded-lg border border-border bg-card p-4 overflow-y-auto min-h-[400px]">
              <h3 className="font-semibold mb-4 flex items-center gap-2">
                <FolderTree className="h-4 w-4" />
                Workspace Structure (/workspace)
              </h3>
              {folderTree ? (
                Object.keys(folderTree).length > 0 ? (
                  renderFolderTree(folderTree)
                ) : (
                  <p className="text-muted-foreground">Workspace is empty</p>
                )
              ) : (
                <p className="text-muted-foreground">Loading folder structure...</p>
              )}
            </div>
          )}
        </div>

        {/* Sidebar - Quick Actions & Info */}
        <div className="space-y-4">
          {/* Workspace Info */}
          <div className="rounded-lg border border-border bg-card p-4">
            <h3 className="font-semibold mb-3">Workspace</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Directory:</span>
                <span className="font-mono">/workspace</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Status:</span>
                <span className="text-green-500">Ready</span>
              </div>
            </div>
          </div>

          {/* Quick Commands */}
          <div className="rounded-lg border border-border bg-card p-4">
            <h3 className="font-semibold mb-3">Quick Commands</h3>
            <div className="space-y-2">
              {[
                { label: 'List files', cmd: 'ls -la' },
                { label: 'Show disk usage', cmd: 'df -h' },
                { label: 'Current directory', cmd: 'pwd' },
                { label: 'System info', cmd: 'uname -a' },
                { label: 'Node version', cmd: 'node --version' },
                { label: 'Git status', cmd: 'git status 2>/dev/null || echo "Not a git repo"' },
              ].map((item) => (
                <button
                  key={item.cmd}
                  onClick={() => {
                    setCommand(item.cmd);
                    setActiveTab('console');
                  }}
                  className="w-full text-left px-3 py-2 text-sm rounded hover:bg-muted/50 transition-colors"
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {/* Claude Code Presets */}
          <div className="rounded-lg border border-border bg-card p-4">
            <h3 className="font-semibold mb-3">Claude Presets</h3>
            <div className="space-y-2">
              {[
                { label: 'Analyze project', prompt: 'Analyze the project structure and describe what this codebase does' },
                { label: 'Find issues', prompt: 'Look for potential bugs or code quality issues in the codebase' },
                { label: 'Create README', prompt: 'Create a comprehensive README.md for this project' },
              ].map((item) => (
                <button
                  key={item.label}
                  onClick={() => {
                    setClaudePrompt(item.prompt);
                    setActiveTab('claude');
                  }}
                  className="w-full text-left px-3 py-2 text-sm rounded hover:bg-muted/50 transition-colors"
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
