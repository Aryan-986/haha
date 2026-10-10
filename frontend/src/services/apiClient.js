import axios from 'axios';

// Centralized API Base URL configuration - normalized to /api/v1
const rawBase = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api/v1';
export const API_BASE = rawBase.endsWith('/api/v1')
  ? rawBase
  : rawBase.endsWith('/api')
    ? `${rawBase}/v1`
    : `${rawBase.replace(/\/+$/, '')}/api/v1`;

/**
 * Shared Axios API client instance with Clerk Bearer token injection
 * Automatically strips redundant /api/v1 prefixes so URLs remain consistent
 */
export const apiClient = axios.create({
  baseURL: API_BASE,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json'
  }
});

// Interceptor: Normalizes URLs and attaches Clerk Bearer token
apiClient.interceptors.request.use(async (config) => {
  try {
    // URL Normalization: Prevent double `/api/v1/api/v1` prefix
    if (config.url) {
      if (config.url.startsWith('/api/v1/')) {
        config.url = config.url.replace('/api/v1', '');
      } else if (config.url === '/api/v1') {
        config.url = '/';
      }
    }

    // Automatically attach Clerk session token when user is signed in
    if (typeof window !== 'undefined' && window.Clerk?.session) {
      const token = await window.Clerk.session.getToken();
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    }
  } catch (err) {
    // Proceed without token if session is not ready
  }
  return config;
}, (error) => {
  return Promise.reject(error);
});

export default apiClient;
