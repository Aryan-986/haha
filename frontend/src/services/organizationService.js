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

/**
 * Fetch all rooms for a department
 * @param {string} deptId - Department MongoDB ID
 */
export async function getDepartmentRooms(deptId) {
  const response = await apiClient.get(`/departments/${deptId}/rooms`);
  return response.data?.rooms || [];
}

/**
 * Create a new room in a department
 * @param {string} deptId - Department MongoDB ID
 * @param {Object} roomData - { roomNumber, name }
 */
export async function createDepartmentRoom(deptId, roomData) {
  const response = await apiClient.post(`/departments/${deptId}/rooms`, roomData);
  return response.data;
}

/**
 * Update an existing room in a department
 * @param {string} deptId - Department MongoDB ID
 * @param {string} roomId - Room MongoDB ID
 * @param {Object} roomData - { roomNumber, name, isActive }
 */
export async function updateDepartmentRoom(deptId, roomId, roomData) {
  const response = await apiClient.patch(`/departments/${deptId}/rooms/${roomId}`, roomData);
  return response.data;
}

/**
 * Safely delete / remove a room from a department
 * @param {string} deptId - Department MongoDB ID
 * @param {string} roomId - Room MongoDB ID
 */
export async function deleteDepartmentRoom(deptId, roomId) {
  const response = await apiClient.delete(`/departments/${deptId}/rooms/${roomId}`);
  return response.data;
}

/**
 * Fetch all counters for a department
 * @param {string} deptId - Department MongoDB ID
 * @param {string} [orgId] - Optional Organization MongoDB ID
 */
export async function getDepartmentCounters(deptId, orgId) {
  const params = orgId ? { orgId } : {};
  const response = await apiClient.get(`/departments/${deptId}/counters`, { params });
  return response.data?.counters || [];
}

/**
 * Create a new counter under a department
 * @param {string} deptId - Department MongoDB ID
 * @param {Object} counterData - { counterNumber, name, roomNumber, organizationId, status, isActive }
 */
export async function createDepartmentCounter(deptId, counterData) {
  const response = await apiClient.post(`/departments/${deptId}/counters`, counterData);
  return response.data;
}

/**
 * Update a counter's details, room, or status
 * @param {string} counterId - Counter MongoDB ID
 * @param {Object} counterData - { name, counterNumber, roomNumber, status, isActive }
 */
export async function updateCounter(counterId, counterData) {
  const response = await apiClient.patch(`/counters/${counterId}`, counterData);
  return response.data;
}

/**
 * Safely delete / remove a counter
 * @param {string} counterId - Counter MongoDB ID
 */
export async function deleteCounter(counterId) {
  const response = await apiClient.delete(`/counters/${counterId}`);
  return response.data;
}

export default {
  getOrganizations,
  createOrganization,
  updateOrganization,
  getDepartments,
  createDepartment,
  deleteOrganization,
  getDepartmentRooms,
  createDepartmentRoom,
  updateDepartmentRoom,
  deleteDepartmentRoom,
  getDepartmentCounters,
  createDepartmentCounter,
  updateCounter,
  deleteCounter
};
