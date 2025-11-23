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

export function resizeTerminal(taskId: string, cols: number, rows: number): void {
  getSocket().emit(WS_EVENTS.TERMINAL_RESIZE, { taskId, cols, rows });
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

export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
