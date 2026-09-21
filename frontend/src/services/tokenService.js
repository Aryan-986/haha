import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';

/**
 * Issue a new token for an organization/department
 * @param {Object} payload - { orgId, deptId }
 */
export async function issueToken(payload) {
  const response = await axios.post(`${API_BASE}/api/v1/tokens/issue`, payload);
  return response.data;
}

/**
 * Track live token status, current position, and dynamic wait times
 * @param {string} ticketId - MongoDB ObjectId or ticketNumber string
 */
export async function trackToken(ticketId) {
  const response = await axios.get(`${API_BASE}/api/v1/tokens/track/${ticketId}`);
  return response.data;
}

/**
 * Transfer a ticket to a target department
 * @param {Object} payload - { ticketId, targetDeptId, workerId }
 */
export async function transferToken(payload) {
  const response = await axios.post(`${API_BASE}/api/v1/tokens/transfer`, payload);
  return response.data;
}

export default {
  issueToken,
  trackToken,
  transferToken
};
