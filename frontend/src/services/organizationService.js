import { apiClient } from './apiClient';

/**
 * Fetch all registered organizations
 * @param {Object} [params] - Optional query params like { type, status }
 */
export async function getOrganizations(params = {}) {
  const response = await apiClient.get('/orgs', { params });
  return response.data;
}

/**
 * Create a new organization
 * @param {Object} orgData - { name, type, address }
 */
export async function createOrganization(orgData) {
  const response = await apiClient.post('/orgs', orgData);
  return response.data;
}

/**
 * Update an existing organization
 * @param {string} orgId - Organization MongoDB ID
 * @param {Object} orgData - { name, type, address, status }
 */
export async function updateOrganization(orgId, orgData) {
  const response = await apiClient.put(`/orgs/${orgId}`, orgData);
  return response.data;
}

/**
 * Fetch all departments/counters for an organization
 * @param {string} orgId - Organization MongoDB ID
 */
export async function getDepartments(orgId) {
  const response = await apiClient.get(`/orgs/${orgId}/departments`);
  return response.data;
}

/**
 * Create a dynamic department under an organization
 * @param {string} orgId - Organization MongoDB ID
 * @param {Object} deptData - { name, prefix, avgServiceTimeMins, subCounters, isEntryLevel, roomNumber }
 */
export async function createDepartment(orgId, deptData) {
  const response = await apiClient.post(`/orgs/${orgId}/departments`, deptData);
  return response.data;
}

/**
 * Soft-delete / archive an organization
 * @param {string} orgId - Organization MongoDB ID
 */
export async function deleteOrganization(orgId) {
  const response = await apiClient.delete(`/orgs/${orgId}`);
  return response.data;
}

export default {
  getOrganizations,
  createOrganization,
  updateOrganization,
  getDepartments,
  createDepartment,
  deleteOrganization
};
