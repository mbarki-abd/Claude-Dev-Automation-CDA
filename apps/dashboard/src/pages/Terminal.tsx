import { useEffect, useState, useRef, useCallback } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import '@xterm/xterm/css/xterm.css';
import {
  Terminal as TerminalIcon,
  Plus,
  X,
  Search,
  Bot,
  Send,
  Maximize2,
  Minimize2,
  ChevronDown,
} from 'lucide-react';
import {
  subscribeToTerminal,
  unsubscribeFromTerminal,
  startInteractiveTerminal,
  startClaudeCode,
  sendTerminalInput,
  killTerminalSession,
  resizeTerminal,
  onTerminalOutput,
  onTerminalError,
  onTerminalExit,
} from '../services/socket';

interface TerminalTab {
  id: string;
  name: string;
  type: 'interactive' | 'claude';
  terminal: XTerm | null;
  fitAddon: FitAddon | null;
  searchAddon: SearchAddon | null;
  sessionId: string | null;
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  workDir: string;
}

export function Terminal() {
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [claudePrompt, setClaudePrompt] = useState('');
  const [showClaudeInput, setShowClaudeInput] = useState(false);
  const [showNewTabMenu, setShowNewTabMenu] = useState(false);
  const terminalContainerRef = useRef<HTMLDivElement>(null);
  const tabCounter = useRef(1);

  // Create a new terminal tab
  const createTab = useCallback((type: 'interactive' | 'claude', name?: string) => {
    const id = `tab-${Date.now()}`;
    const tabName = name || (type === 'interactive' ? `Terminal ${tabCounter.current++}` : `Claude ${tabCounter.current++}`);

    const newTab: TerminalTab = {
      id,
      name: tabName,
      type,
      terminal: null,
      fitAddon: null,
      searchAddon: null,
      sessionId: null,
      status: 'connecting',
      workDir: '/workspace',
    };

    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(id);
    setShowNewTabMenu(false);
    return id;
  }, []);

  // Initialize terminal for a tab
  const initializeTerminal = useCallback((tabId: string, container: HTMLElement) => {
    setTabs((prev) => {
      const tabIndex = prev.findIndex((t) => t.id === tabId);
      if (tabIndex === -1) return prev;

      const tab = prev[tabIndex];
      if (tab.terminal) return prev; // Already initialized

      // Create xterm instance
      const terminal = new XTerm({
        cursorBlink: true,
        cursorStyle: 'block',
        fontSize: 14,
        fontFamily: 'JetBrains Mono, Menlo, Monaco, Consolas, monospace',
        theme: {
          background: '#0d1117',
          foreground: '#c9d1d9',
          cursor: '#58a6ff',
          cursorAccent: '#0d1117',
          selectionBackground: '#264f78',
          black: '#484f58',
          red: '#ff7b72',
          green: '#3fb950',
          yellow: '#d29922',
          blue: '#58a6ff',
          magenta: '#bc8cff',
          cyan: '#39c5cf',
          white: '#b1bac4',
          brightBlack: '#6e7681',
          brightRed: '#ffa198',
          brightGreen: '#56d364',
          brightYellow: '#e3b341',
          brightBlue: '#79c0ff',
          brightMagenta: '#d2a8ff',
          brightCyan: '#56d4dd',
          brightWhite: '#f0f6fc',
        },
        allowTransparency: true,
        scrollback: 10000,
        tabStopWidth: 4,
      });

      // Create addons
      const fitAddon = new FitAddon();
      const webLinksAddon = new WebLinksAddon();
      const searchAddon = new SearchAddon();

      terminal.loadAddon(fitAddon);
      terminal.loadAddon(webLinksAddon);
      terminal.loadAddon(searchAddon);

      terminal.open(container);
      fitAddon.fit();

      // Generate session ID
      const sessionId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // Subscribe to WebSocket events for this session
      subscribeToTerminal(sessionId);

      // Start the appropriate session type
      if (tab.type === 'interactive') {
        startInteractiveTerminal({ sessionId, workDir: tab.workDir });
      }

      // Handle terminal input
      terminal.onData((data) => {
        if (tab.type === 'interactive') {
          sendTerminalInput(sessionId, data);
        }
      });

      // Update tab state
      const updatedTabs = [...prev];
      updatedTabs[tabIndex] = {
        ...tab,
        terminal,
        fitAddon,
        searchAddon,
        sessionId,
        status: 'connected',
      };

      return updatedTabs;
    });
  }, []);

  // Close a tab
  const closeTab = useCallback((tabId: string) => {
    setTabs((prev) => {
      const tab = prev.find((t) => t.id === tabId);
      if (tab) {
        if (tab.sessionId) {
          unsubscribeFromTerminal(tab.sessionId);
          killTerminalSession(tab.sessionId);
        }
        tab.terminal?.dispose();
      }
      return prev.filter((t) => t.id !== tabId);
    });

    // Select another tab if the active one was closed
    setActiveTabId((current) => {
      if (current === tabId) {
        const remainingTabs = tabs.filter((t) => t.id !== tabId);
        return remainingTabs.length > 0 ? remainingTabs[remainingTabs.length - 1].id : null;
      }
      return current;
    });
  }, [tabs]);

  // Handle WebSocket events
  useEffect(() => {
    const unsubOutput = onTerminalOutput((data) => {
      setTabs((prev) => {
        const tab = prev.find((t) => t.sessionId === data.sessionId);
        if (tab?.terminal) {
          tab.terminal.write(data.data);
        }
        return prev;
      });
    });

    const unsubError = onTerminalError((data) => {
      setTabs((prev) => {
        const tab = prev.find((t) => t.sessionId === data.sessionId);
        if (tab?.terminal) {
          tab.terminal.write(`\r\n\x1b[31mError: ${data.error}\x1b[0m\r\n`);
        }
        return prev.map((t) =>
          t.sessionId === data.sessionId ? { ...t, status: 'error' as const } : t
        );
      });
    });

    const unsubExit = onTerminalExit((data) => {
      setTabs((prev) => {
        const tab = prev.find((t) => t.sessionId === data.sessionId);
        if (tab?.terminal) {
          tab.terminal.write(`\r\n\x1b[33m[Process exited with code ${data.exitCode}]\x1b[0m\r\n`);
        }
        return prev.map((t) =>
          t.sessionId === data.sessionId ? { ...t, status: 'disconnected' as const } : t
        );
      });
    });

    return () => {
      unsubOutput();
      unsubError();
      unsubExit();
    };
  }, []);

  // Handle resize
  useEffect(() => {
    const handleResize = () => {
      tabs.forEach((tab) => {
        if (tab.fitAddon && tab.terminal) {
          tab.fitAddon.fit();
          if (tab.sessionId) {
            resizeTerminal(tab.sessionId, tab.terminal.cols, tab.terminal.rows);
          }
        }
      });
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [tabs]);

  // Create initial tab
  useEffect(() => {
    if (tabs.length === 0) {
      createTab('interactive', 'Terminal 1');
    }
  }, []);

  // Initialize terminal when container is available
  useEffect(() => {
    const activeTab = tabs.find((t) => t.id === activeTabId);
    if (activeTab && !activeTab.terminal && terminalContainerRef.current) {
      // Clear container
      terminalContainerRef.current.innerHTML = '';
      initializeTerminal(activeTab.id, terminalContainerRef.current);
    }
  }, [activeTabId, tabs, initializeTerminal]);

  // Switch terminal display when tab changes
  useEffect(() => {
    tabs.forEach((tab) => {
      if (tab.terminal) {
        const element = tab.terminal.element;
        if (element) {
          element.style.display = tab.id === activeTabId ? 'block' : 'none';
        }
        if (tab.id === activeTabId && tab.fitAddon) {
          setTimeout(() => tab.fitAddon?.fit(), 0);
        }
      }
    });
  }, [activeTabId, tabs]);

  // Send Claude prompt
  const sendClaudePrompt = () => {
    if (!claudePrompt.trim()) return;

    const activeTab = tabs.find((t) => t.id === activeTabId);
    if (!activeTab?.sessionId) {
      // Create new Claude tab
      const tabId = createTab('claude', 'Claude');
      const sessionId = `claude-${Date.now()}`;

      // Start Claude session after tab is created
      setTimeout(() => {
        startClaudeCode({ prompt: claudePrompt, workDir: '/workspace', sessionId });
        subscribeToTerminal(sessionId);
        setTabs((prev) =>
          prev.map((t) => (t.id === tabId ? { ...t, sessionId, status: 'connected' as const } : t))
        );
      }, 100);
    } else if (activeTab.type === 'claude') {
      // Send to existing Claude session
      startClaudeCode({ prompt: claudePrompt, workDir: activeTab.workDir, sessionId: activeTab.sessionId });
    }

    setClaudePrompt('');
    setShowClaudeInput(false);
  };

  // Search in terminal
  const handleSearch = (direction: 'next' | 'prev') => {
    const activeTab = tabs.find((t) => t.id === activeTabId);
    if (activeTab?.searchAddon && searchQuery) {
      if (direction === 'next') {
        activeTab.searchAddon.findNext(searchQuery);
      } else {
        activeTab.searchAddon.findPrevious(searchQuery);
      }
    }
  };

  const activeTab = tabs.find((t) => t.id === activeTabId);

  return (
    <div className={`flex flex-col h-full ${isFullscreen ? 'fixed inset-0 z-50 bg-background' : ''}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-card border-b border-border">
        <div className="flex items-center gap-2">
          <TerminalIcon className="h-5 w-5 text-primary" />
          <h1 className="font-semibold">Terminal</h1>
          <span className="text-xs text-muted-foreground">
            {tabs.length} session{tabs.length !== 1 ? 's' : ''}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Search */}
          {showSearch && (
            <div className="flex items-center gap-1">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search..."
                className="px-2 py-1 text-sm bg-background border border-border rounded"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSearch(e.shiftKey ? 'prev' : 'next');
                  if (e.key === 'Escape') setShowSearch(false);
                }}
              />
              <button
                onClick={() => handleSearch('prev')}
                className="p-1 hover:bg-muted rounded"
                title="Previous (Shift+Enter)"
              >
                ↑
              </button>
              <button
                onClick={() => handleSearch('next')}
                className="p-1 hover:bg-muted rounded"
                title="Next (Enter)"
              >
                ↓
              </button>
            </div>
          )}

          <button
            onClick={() => setShowSearch(!showSearch)}
            className={`p-2 rounded hover:bg-muted ${showSearch ? 'bg-muted' : ''}`}
            title="Search (Ctrl+F)"
          >
            <Search className="h-4 w-4" />
          </button>

          <button
            onClick={() => setShowClaudeInput(!showClaudeInput)}
            className={`p-2 rounded hover:bg-muted ${showClaudeInput ? 'bg-primary text-primary-foreground' : ''}`}
            title="Claude Code"
          >
            <Bot className="h-4 w-4" />
          </button>

          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="p-2 rounded hover:bg-muted"
            title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Claude Input */}
      {showClaudeInput && (
        <div className="px-4 py-3 bg-purple-500/10 border-b border-purple-500/20">
          <div className="flex gap-2">
            <textarea
              value={claudePrompt}
              onChange={(e) => setClaudePrompt(e.target.value)}
              placeholder="Enter prompt for Claude Code..."
              rows={2}
              className="flex-1 px-3 py-2 text-sm bg-background border border-border rounded resize-none focus:outline-none focus:ring-2 focus:ring-purple-500"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  sendClaudePrompt();
                }
              }}
            />
            <button
              onClick={sendClaudePrompt}
              disabled={!claudePrompt.trim()}
              className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50 flex items-center gap-2"
            >
              <Send className="h-4 w-4" />
              Send
            </button>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Press Ctrl+Enter to send. Opens in new Claude tab.
          </p>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center bg-muted/30 border-b border-border overflow-x-auto">
        <div className="flex items-center flex-1 min-w-0">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              onClick={() => setActiveTabId(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 cursor-pointer border-r border-border min-w-0 group ${
                tab.id === activeTabId
                  ? 'bg-background text-foreground'
                  : 'text-muted-foreground hover:bg-muted/50'
              }`}
            >
              {tab.type === 'claude' ? (
                <Bot className="h-4 w-4 text-purple-500 flex-shrink-0" />
              ) : (
                <TerminalIcon className="h-4 w-4 flex-shrink-0" />
              )}
              <span className="truncate text-sm">{tab.name}</span>
              <span
                className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  tab.status === 'connected'
                    ? 'bg-green-500'
                    : tab.status === 'error'
                    ? 'bg-red-500'
                    : tab.status === 'disconnected'
                    ? 'bg-gray-500'
                    : 'bg-yellow-500 animate-pulse'
                }`}
              />
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
                className="p-1 rounded hover:bg-red-500/20 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>

        {/* New Tab Button */}
        <div className="relative">
          <button
            onClick={() => setShowNewTabMenu(!showNewTabMenu)}
            className="flex items-center gap-1 px-3 py-2 text-muted-foreground hover:text-foreground hover:bg-muted/50"
          >
            <Plus className="h-4 w-4" />
            <ChevronDown className="h-3 w-3" />
          </button>

          {showNewTabMenu && (
            <div className="absolute right-0 top-full mt-1 bg-card border border-border rounded-lg shadow-lg z-10 min-w-[180px]">
              <button
                onClick={() => createTab('interactive')}
                className="flex items-center gap-2 w-full px-4 py-2 text-sm hover:bg-muted"
              >
                <TerminalIcon className="h-4 w-4" />
                New Terminal
              </button>
              <button
                onClick={() => {
                  setShowClaudeInput(true);
                  setShowNewTabMenu(false);
                }}
                className="flex items-center gap-2 w-full px-4 py-2 text-sm hover:bg-muted"
              >
                <Bot className="h-4 w-4 text-purple-500" />
                New Claude Session
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Terminal Container */}
      <div
        ref={terminalContainerRef}
        className="flex-1 min-h-0 bg-[#0d1117]"
        style={{ padding: '8px' }}
      />

      {/* Status Bar */}
      <div className="flex items-center justify-between px-4 py-1 bg-muted/30 border-t border-border text-xs text-muted-foreground">
        <div className="flex items-center gap-4">
          <span>
            {activeTab?.type === 'interactive' ? 'bash' : 'claude-code'}
          </span>
          <span>{activeTab?.workDir || '/workspace'}</span>
        </div>
        <div className="flex items-center gap-4">
          <span>
            {activeTab?.terminal ? `${activeTab.terminal.cols}x${activeTab.terminal.rows}` : '-'}
          </span>
          <span className="flex items-center gap-1">
            <span
              className={`w-2 h-2 rounded-full ${
                activeTab?.status === 'connected'
                  ? 'bg-green-500'
                  : activeTab?.status === 'error'
                  ? 'bg-red-500'
                  : 'bg-gray-500'
              }`}
            />
            {activeTab?.status || 'no session'}
          </span>
        </div>
      </div>
    </div>
  );
}
