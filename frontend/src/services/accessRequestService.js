import apiClient from './apiClient';

/**
 * Access Request & Staff Management API Service
 */

// ── User / Applicant APIs ──────────────────────────────────────
export async function getMyAccessStatus() {
  const res = await apiClient.get('/access-requests/my/status');
  return res.data;
}

export async function getMyAccessRequests() {
  const res = await apiClient.get('/access-requests/my');
  return res.data;
}

export async function submitAccessRequest(data) {
  const res = await apiClient.post('/access-requests', data);
  return res.data;
}

export async function cancelAccessRequest(id) {
  const res = await apiClient.delete(`/access-requests/${id}`);
  return res.data;
}

// ── Master Admin: Request Management ───────────────────────────
export async function getAccessRequests(params = {}) {
  const res = await apiClient.get('/access-requests', { params });
  return res.data;
}

export async function getAccessRequestDetails(id) {
  const res = await apiClient.get(`/access-requests/${id}`);
  return res.data;
}

export async function approveAccessRequest(id, data) {
  const res = await apiClient.post(`/access-requests/${id}/approve`, data);
  return res.data;
}

export async function rejectAccessRequest(id, data) {
  const res = await apiClient.post(`/access-requests/${id}/reject`, data);
  return res.data;
}

// ── Master Admin: Staff Directory ──────────────────────────────
export async function getStaffList(params = {}) {
  const res = await apiClient.get('/access-requests/staff/list', { params });
  return res.data;
}

export async function getStaffDetails(id) {
  const res = await apiClient.get(`/access-requests/staff/${id}`);
  return res.data;
}

export async function updateStaffAssignment(id, data) {
  const res = await apiClient.patch(`/access-requests/staff/${id}`, data);
  return res.data;
}

export async function deactivateStaff(id) {
  const res = await apiClient.post(`/access-requests/staff/${id}/deactivate`);
  return res.data;
}

export async function reactivateStaff(id) {
  const res = await apiClient.post(`/access-requests/staff/${id}/reactivate`);
  return res.data;
}

export async function revokeStaffMembership(id) {
  const res = await apiClient.post(`/access-requests/staff/${id}/revoke`);
  return res.data;
}

// ── Master Admin: Audit Logs ───────────────────────────────────
export async function getAuditLogs(params = {}) {
  const res = await apiClient.get('/access-requests/audit-logs', { params });
  return res.data;
}
