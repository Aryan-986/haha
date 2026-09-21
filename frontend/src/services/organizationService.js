import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';

/**
 * Fetch all registered organizations
 * @param {Object} [params] - Optional query params like { type, status }
 */
export async function getOrganizations(params = {}) {
  const response = await axios.get(`${API_BASE}/api/v1/orgs`, { params });
  return response.data;
}

/**
 * Create a new organization
 * @param {Object} orgData - { name, type, address }
 */
export async function createOrganization(orgData) {
  const response = await axios.post(`${API_BASE}/api/v1/orgs`, orgData);
  return response.data;
}

/**
 * Fetch all departments/counters for an organization
 * @param {string} orgId - Organization MongoDB ID
 */
export async function getDepartments(orgId) {
  const response = await axios.get(`${API_BASE}/api/v1/orgs/${orgId}/departments`);
  return response.data;
}

/**
 * Create a dynamic department under an organization
 * @param {string} orgId - Organization MongoDB ID
 * @param {Object} deptData - { name, prefix, avgServiceTimeMins, subCounters, isEntryLevel }
 */
export async function createDepartment(orgId, deptData) {
  const response = await axios.post(`${API_BASE}/api/v1/orgs/${orgId}/departments`, deptData);
  return response.data;
}

export default {
  getOrganizations,
  createOrganization,
  getDepartments,
  createDepartment
};
