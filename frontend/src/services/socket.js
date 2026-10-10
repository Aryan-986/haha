import { io } from 'socket.io-client';
import { API_BASE } from './apiClient';

let socketInstance = null;
const reconnectCallbacks = new Set();
const statusListeners = new Set();
let currentStatus = 'disconnected';

function notifyStatus(status) {
  currentStatus = status;
  statusListeners.forEach((listener) => {
    try {
      listener(status);
    } catch (e) {
      console.error('Error in socket status listener:', e);
    }
  });
}

/**
 * Get or initialize the shared singleton Socket.io client instance
 */
export function getSocket() {
  if (!socketInstance) {
    socketInstance = io(API_BASE, {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 15,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 10000
    });

    socketInstance.on('connect', () => {
      notifyStatus('connected');
    });

    socketInstance.on('disconnect', (reason) => {
      notifyStatus('disconnected');
    });

    socketInstance.on('connect_error', (error) => {
      notifyStatus('disconnected');
    });

    socketInstance.io.on('reconnect_attempt', () => {
      notifyStatus('reconnecting');
    });

    socketInstance.io.on('reconnect', () => {
      notifyStatus('connected');
      // Trigger all registered refresh callbacks on reconnect to fetch authoritative queue data
      reconnectCallbacks.forEach((cb) => {
        try {
          cb();
        } catch (err) {
          console.error('Error executing reconnect callback:', err);
        }
      });
    });
  }

  return socketInstance;
}

/**
 * Register a callback to be executed whenever the socket reconnects.
 * Returns an unregister function.
 */
export function onSocketReconnect(callback) {
  reconnectCallbacks.add(callback);
  return () => {
    reconnectCallbacks.delete(callback);
  };
}

/**
 * Subscribe to socket connection status updates ('connected' | 'reconnecting' | 'disconnected')
 */
export function onSocketStatusChange(listener) {
  statusListeners.add(listener);
  // Send current status immediately
  listener(currentStatus);
  return () => {
    statusListeners.delete(listener);
  };
}

export default {
  getSocket,
  onSocketReconnect,
  onSocketStatusChange
};
