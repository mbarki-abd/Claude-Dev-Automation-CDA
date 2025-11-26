import { io, Socket } from 'socket.io-client';
import { WS_EVENTS } from '@cda/shared';

const WS_URL = import.meta.env.VITE_WS_URL || window.location.origin;

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(WS_URL, {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    socket.on('connect', () => {
      console.log('WebSocket connected');
    });

    socket.on('disconnect', (reason) => {
      console.log('WebSocket disconnected:', reason);
    });

    socket.on('connect_error', (error) => {
      console.error('WebSocket connection error:', error);
    });
  }

  return socket;
}

export function subscribeToTask(taskId: string): void {
  getSocket().emit('subscribe:task', taskId);
}

export function unsubscribeFromTask(taskId: string): void {
  getSocket().emit('unsubscribe:task', taskId);
}

export function cancelTask(taskId: string): void {
  getSocket().emit(WS_EVENTS.TASK_CANCEL, { taskId });
}

export function resolveProposal(proposalId: string, option: string): void {
  getSocket().emit(WS_EVENTS.PROPOSAL_RESOLVE, { proposalId, option });
}

export function resizeTerminal(sessionId: string, cols: number, rows: number): void {
  getSocket().emit(WS_EVENTS.TERMINAL_RESIZE, { sessionId, cols, rows });
}

// Terminal functions
export function subscribeToTerminal(sessionId: string): void {
  getSocket().emit('subscribe:terminal', sessionId);
}

export function unsubscribeFromTerminal(sessionId: string): void {
  getSocket().emit('unsubscribe:terminal', sessionId);
}

export function startTerminalCommand(data: { command: string; args?: string[]; workDir?: string; sessionId?: string }): void {
  getSocket().emit(WS_EVENTS.TERMINAL_START, data);
}

export function startClaudeCode(data: { prompt: string; workDir?: string; sessionId?: string }): void {
  getSocket().emit('terminal:claude-code', data);
}

export function startInteractiveTerminal(data: { workDir?: string; sessionId?: string }): void {
  getSocket().emit('terminal:interactive', data);
}

export function sendTerminalInput(sessionId: string, input: string): void {
  getSocket().emit(WS_EVENTS.TERMINAL_INPUT, { sessionId, input });
}

export function killTerminalSession(sessionId: string): void {
  getSocket().emit(WS_EVENTS.TERMINAL_KILL, { sessionId });
}

export function triggerSync(): void {
  getSocket().emit(WS_EVENTS.SYNC_TRIGGER, {});
}

// Event listeners
export function onTaskStarted(callback: (data: { taskId: string; timestamp: Date }) => void): () => void {
  const socket = getSocket();
  socket.on(WS_EVENTS.TASK_STARTED, callback);
  return () => socket.off(WS_EVENTS.TASK_STARTED, callback);
}

export function onTaskOutput(
  callback: (data: { taskId: string; data: string; stream: 'stdout' | 'stderr' }) => void
): () => void {
  const socket = getSocket();
  socket.on(WS_EVENTS.TASK_OUTPUT, callback);
  return () => socket.off(WS_EVENTS.TASK_OUTPUT, callback);
}

export function onTaskCompleted(
  callback: (data: { taskId: string; result: unknown; duration: number }) => void
): () => void {
  const socket = getSocket();
  socket.on(WS_EVENTS.TASK_COMPLETED, callback);
  return () => socket.off(WS_EVENTS.TASK_COMPLETED, callback);
}

export function onTaskFailed(callback: (data: { taskId: string; error: string }) => void): () => void {
  const socket = getSocket();
  socket.on(WS_EVENTS.TASK_FAILED, callback);
  return () => socket.off(WS_EVENTS.TASK_FAILED, callback);
}

export function onProposalCreated(callback: (data: { proposal: unknown }) => void): () => void {
  const socket = getSocket();
  socket.on(WS_EVENTS.PROPOSAL_CREATED, callback);
  return () => socket.off(WS_EVENTS.PROPOSAL_CREATED, callback);
}

export function onSyncUpdate(callback: (data: { tasks: unknown[] }) => void): () => void {
  const socket = getSocket();
  socket.on(WS_EVENTS.SYNC_UPDATE, callback);
  return () => socket.off(WS_EVENTS.SYNC_UPDATE, callback);
}

// Terminal event listeners
export function onTerminalStarted(callback: (data: { sessionId: string }) => void): () => void {
  const socket = getSocket();
  socket.on(WS_EVENTS.TERMINAL_STARTED, callback);
  return () => socket.off(WS_EVENTS.TERMINAL_STARTED, callback);
}

export function onTerminalOutput(
  callback: (data: { sessionId: string; data: string; type: 'stdout' | 'stderr' }) => void
): () => void {
  const socket = getSocket();
  socket.on(WS_EVENTS.TERMINAL_OUTPUT, callback);
  return () => socket.off(WS_EVENTS.TERMINAL_OUTPUT, callback);
}

export function onTerminalError(callback: (data: { sessionId: string; error: string }) => void): () => void {
  const socket = getSocket();
  socket.on(WS_EVENTS.TERMINAL_ERROR, callback);
  return () => socket.off(WS_EVENTS.TERMINAL_ERROR, callback);
}

export function onTerminalExit(callback: (data: { sessionId: string; exitCode: number }) => void): () => void {
  const socket = getSocket();
  socket.on(WS_EVENTS.TERMINAL_EXIT, callback);
  return () => socket.off(WS_EVENTS.TERMINAL_EXIT, callback);
}

export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
