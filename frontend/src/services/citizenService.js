import { apiClient } from './apiClient';

/**
 * Fetch all active organizations for citizens
 */
export async function getCitizenOrganizations() {
  const response = await apiClient.get('/api/v1/orgs');
  return response.data || [];
}

/**
 * Fetch active departments for a specific organization
 */
export async function getCitizenDepartments(orgId) {
  if (!orgId) return [];
  const response = await apiClient.get(`/api/v1/orgs/${orgId}/departments`);
  return response.data || [];
}

/**
 * Issue a real queue ticket for the citizen
 */
export async function issueCitizenTicket({
  organizationId,
  departmentId,
  serviceId,
  priority = 'NORMAL',
  source = 'WEB',
  roomNumber,
  idempotencyKey
}) {
  const headers = {};
  if (idempotencyKey) {
    headers['Idempotency-Key'] = idempotencyKey;
  }

  const response = await apiClient.post(
    '/api/v1/tickets',
    {
      organizationId,
      departmentId,
      serviceId,
      priority,
      source,
      roomNumber,
      idempotencyKey
    },
    { headers }
  );

  return response.data;
}

/**
 * Fetch ticket details by ID or ticketNumber
 */
export async function getTicketDetails(ticketIdOrNumber) {
  const response = await apiClient.get(`/api/v1/tickets/${encodeURIComponent(ticketIdOrNumber)}`);
  return response.data;
}

/**
 * Track ticket anonymously using secure tracking token
 */
export async function trackTicketByToken(trackingToken) {
  const response = await apiClient.get(`/api/v1/tickets/track/${encodeURIComponent(trackingToken)}`);
  return response.data;
}

/**
 * Fetch live priority-aware queue position
 */
export async function getTicketPosition(ticketId) {
  const response = await apiClient.get(`/api/v1/tickets/${ticketId}/position`);
  return response.data;
}

/**
 * Fetch live queue ETA
 */
export async function getTicketETA(ticketId) {
  const response = await apiClient.get(`/api/v1/tickets/${ticketId}/eta`);
  return response.data;
}

/**
 * Snooze / delay ticket by specified minutes (citizen delay request)
 */
export async function snoozeCitizenTicket(ticketId, minutes = 5) {
  const response = await apiClient.post(`/api/v1/tickets/${ticketId}/snooze`, {
    minutes,
    source: 'CITIZEN'
  });
  return response.data;
}

/**
 * Fetch multi-department journey stages
 */
export async function getTicketJourney(ticketId) {
  const response = await apiClient.get(`/api/v1/tickets/${ticketId}/journey`);
  return response.data;
}

/**
 * Fetch QueueEvent timeline (safe audit trail)
 */
export async function getTicketEvents(ticketId) {
  const response = await apiClient.get(`/api/v1/tickets/${ticketId}/events`);
  return response.data?.events || [];
}

export default {
  getCitizenOrganizations,
  getCitizenDepartments,
  issueCitizenTicket,
  getTicketDetails,
  trackTicketByToken,
  getTicketPosition,
  getTicketETA,
  snoozeCitizenTicket,
  getTicketJourney,
  getTicketEvents
};
