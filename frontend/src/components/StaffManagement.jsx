import React, { useState, useEffect } from 'react';
import {
  Users, UserCheck, Clock, CheckCircle2, XCircle, Search, Filter,
  ShieldAlert, RefreshCw, AlertTriangle, Eye, ChevronRight, Building2,
  Lock, Ban, Check, History, Sparkles, Plus, DoorOpen
} from 'lucide-react';
import {
  getAccessRequests, approveAccessRequest, rejectAccessRequest,
  getStaffList, deactivateStaff, reactivateStaff, revokeStaffMembership,
  getAuditLogs
} from '../services/accessRequestService';
import { getOrganizations } from '../services/organizationService';
import apiClient from '../services/apiClient';
import DepartmentLocationManager from './DepartmentLocationManager';

export default function StaffManagement() {
  const [subTab, setSubTab] = useState('requests'); // 'requests' | 'staff' | 'history'

  // Common metadata
  const [organizations, setOrganizations] = useState([]);

  // Requests state
  const [requests, setRequests] = useState([]);
  const [requestFilter, setRequestFilter] = useState({
    status: 'PENDING',
    organizationId: '',
    role: '',
    search: ''
  });
  const [requestsLoading, setRequestsLoading] = useState(false);

  // Staff directory state
  const [staff, setStaff] = useState([]);
  const [staffFilter, setStaffFilter] = useState({
    status: '',
    organizationId: '',
    role: '',
    search: ''
  });
  const [staffLoading, setStaffLoading] = useState(false);

  // Audit history state
  const [auditLogs, setAuditLogs] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Active modals
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [approveModalOpen, setApproveModalOpen] = useState(false);
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [actionConfirmModal, setActionConfirmModal] = useState(null); // { type, staffId, staffName, orgName }

  // Approval form state
  const [approvalData, setApprovalData] = useState({
    approvedRole: 'WORKER',
    organizationId: '',
    departmentId: '',
    counterId: '',
    notes: ''
  });
  const [rejectionReason, setRejectionReason] = useState('');
  const [departmentsForOrg, setDepartmentsForOrg] = useState([]);
  const [countersForDept, setCountersForDept] = useState([]);
  const [processingAction, setProcessingAction] = useState(false);
  const [feedback, setFeedback] = useState(null); // { type: 'success' | 'error', message }

  // Quick counter creation & location manager state
  const [locationManagerOpen, setLocationManagerOpen] = useState(false);
  const [showQuickAddCounter, setShowQuickAddCounter] = useState(false);
  const [quickCounterForm, setQuickCounterForm] = useState({
    counterNumber: '',
    name: '',
    roomNumber: ''
  });
  const [quickCounterSubmitting, setQuickCounterSubmitting] = useState(false);
  const [quickCounterError, setQuickCounterError] = useState('');

  useEffect(() => {
    loadOrganizations();
  }, []);

  useEffect(() => {
    if (subTab === 'requests') loadRequests();
    if (subTab === 'staff') loadStaff();
    if (subTab === 'history') loadHistory();
  }, [subTab, requestFilter, staffFilter]);

  async function loadOrganizations() {
    try {
      const orgs = await getOrganizations();
      setOrganizations(Array.isArray(orgs) ? orgs : []);
    } catch (err) {
      console.warn('Failed to load organizations', err);
    }
  }

  async function loadRequests() {
    setRequestsLoading(true);
    try {
      const data = await getAccessRequests(requestFilter);
      setRequests(data.requests || []);
    } catch (err) {
      setFeedback({ type: 'error', message: 'Failed to fetch access requests.' });
    } finally {
      setRequestsLoading(false);
    }
  }

  async function loadStaff() {
    setStaffLoading(true);
    try {
      const data = await getStaffList(staffFilter);
      setStaff(data.staff || []);
    } catch (err) {
      setFeedback({ type: 'error', message: 'Failed to fetch staff directory.' });
    } finally {
      setStaffLoading(false);
    }
  }

  async function loadHistory() {
    setHistoryLoading(true);
    try {
      const data = await getAuditLogs();
      setAuditLogs(data.logs || []);
    } catch (err) {
      setFeedback({ type: 'error', message: 'Failed to fetch audit history.' });
    } finally {
      setHistoryLoading(false);
    }
  }

  // Open approval modal and pre-load org departments
  async function openApproveModal(req) {
    setSelectedRequest(req);
    const orgId = req.organizationId?._id || req.organizationId;
    setApprovalData({
      approvedRole: req.requestedRole || 'WORKER',
      organizationId: orgId,
      departmentId: '',
      counterId: '',
      notes: ''
    });
    setApproveModalOpen(true);
    await loadDepartments(orgId);
  }

  async function loadDepartments(orgId) {
    if (!orgId) {
      setDepartmentsForOrg([]);
      return;
    }
    try {
      const res = await apiClient.get(`/orgs/${orgId}/departments`);
      const depts = res.data?.departments || res.data || [];
      setDepartmentsForOrg(Array.isArray(depts) ? depts : []);
    } catch (err) {
      setDepartmentsForOrg([]);
    }
  }

  async function loadCounters(deptId) {
    if (!deptId) {
      setCountersForDept([]);
      return;
    }
    try {
      const res = await apiClient.get(`/departments/${deptId}/counters`);
      const counters = res.data?.counters || res.data || [];
      setCountersForDept(Array.isArray(counters) ? counters : []);
    } catch (err) {
      setCountersForDept([]);
    }
  }

  async function handleQuickCreateCounter(e) {
    if (e) e.preventDefault();
    if (!approvalData.departmentId) return;
    if (!quickCounterForm.counterNumber) {
      setQuickCounterError('Counter number is required');
      return;
    }
    setQuickCounterSubmitting(true);
    setQuickCounterError('');
    try {
      const res = await apiClient.post(`/departments/${approvalData.departmentId}/counters`, {
        counterNumber: parseInt(quickCounterForm.counterNumber, 10),
        name: quickCounterForm.name.trim() || `Counter ${quickCounterForm.counterNumber}`,
        roomNumber: quickCounterForm.roomNumber.trim() || undefined,
        status: 'ACTIVE',
        isActive: true
      });
      const newCounter = res.data?.counter;
      await loadCounters(approvalData.departmentId);
      if (newCounter?._id) {
        setApprovalData(prev => ({ ...prev, counterId: newCounter._id }));
      }
      setShowQuickAddCounter(false);
      setQuickCounterForm({ counterNumber: '', name: '', roomNumber: '' });
      setFeedback({ type: 'success', message: `Created and assigned Counter ${newCounter?.counterNumber || ''}!` });
    } catch (err) {
      setQuickCounterError(err.response?.data?.error || err.message || 'Failed to create counter');
    } finally {
      setQuickCounterSubmitting(false);
    }
  }

  async function handleApproveSubmit(e) {
    e.preventDefault();
    if (!selectedRequest) return;
    setProcessingAction(true);
    try {
      await approveAccessRequest(selectedRequest._id, approvalData);
      setFeedback({ type: 'success', message: `Approved access for ${selectedRequest.applicantName}.` });
      setApproveModalOpen(false);
      setSelectedRequest(null);
      await loadRequests();
      if (subTab === 'staff') await loadStaff();
    } catch (err) {
      setFeedback({ type: 'error', message: err.response?.data?.error || 'Failed to approve request.' });
    } finally {
      setProcessingAction(false);
    }
  }

  async function handleRejectSubmit(e) {
    e.preventDefault();
    if (!selectedRequest) return;
    setProcessingAction(true);
    try {
      await rejectAccessRequest(selectedRequest._id, { reason: rejectionReason });
      setFeedback({ type: 'success', message: `Rejected access request for ${selectedRequest.applicantName}.` });
      setRejectModalOpen(false);
      setSelectedRequest(null);
      setRejectionReason('');
      await loadRequests();
    } catch (err) {
      setFeedback({ type: 'error', message: err.response?.data?.error || 'Failed to reject request.' });
    } finally {
      setProcessingAction(false);
    }
  }

  async function handleStaffActionConfirm() {
    if (!actionConfirmModal) return;
    const { type, staffId, staffName } = actionConfirmModal;
    setProcessingAction(true);
    try {
      if (type === 'deactivate') {
        await deactivateStaff(staffId);
        setFeedback({ type: 'success', message: `${staffName} deactivated.` });
      } else if (type === 'reactivate') {
        await reactivateStaff(staffId);
        setFeedback({ type: 'success', message: `${staffName} reactivated.` });
      } else if (type === 'revoke') {
        await revokeStaffMembership(staffId);
        setFeedback({ type: 'success', message: `Membership revoked for ${staffName}.` });
      }
      setActionConfirmModal(null);
      await loadStaff();
    } catch (err) {
      setFeedback({ type: 'error', message: err.response?.data?.error || `Failed to ${type} staff.` });
    } finally {
      setProcessingAction(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Tab Switcher Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-200 pb-4">
        <div>
          <h2 className="text-xl font-bold text-neutral-900 tracking-tight">Staff Management</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Review onboarding requests, manage authorized staff scopes, and inspect administrative audit logs.
          </p>
        </div>

        <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-lg">
          <button
            type="button"
            onClick={() => setSubTab('requests')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition cursor-pointer ${
              subTab === 'requests' ? 'bg-emerald-700 text-white shadow-2xs' : 'text-gray-600 hover:text-neutral-900'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>Access Requests</span>
            {requests.filter(r => r.status === 'PENDING').length > 0 && (
              <span className="ml-1 px-1.5 py-0.2 bg-amber-400 text-neutral-950 font-bold rounded-full text-[10px]">
                {requests.filter(r => r.status === 'PENDING').length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setSubTab('staff')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition cursor-pointer ${
              subTab === 'staff' ? 'bg-emerald-700 text-white shadow-2xs' : 'text-gray-600 hover:text-neutral-900'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>All Staff Directory</span>
          </button>

          <button
            type="button"
            onClick={() => setSubTab('history')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition cursor-pointer ${
              subTab === 'history' ? 'bg-emerald-700 text-white shadow-2xs' : 'text-gray-600 hover:text-neutral-900'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>Audit History</span>
          </button>
        </div>
      </div>

      {/* Global Alert / Feedback */}
      {feedback && (
        <div
          className={`p-3.5 rounded-lg flex items-center justify-between text-xs font-medium ${
            feedback.type === 'success' ? 'bg-emerald-50 text-emerald-900 border border-emerald-200' : 'bg-red-50 text-red-900 border border-red-200'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedback.type === 'success' ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <AlertTriangle className="w-4 h-4 text-red-600" />}
            <span>{feedback.message}</span>
          </div>
          <button type="button" onClick={() => setFeedback(null)} className="text-gray-400 hover:text-gray-600 font-bold ml-4">✕</button>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────── */}
      {/* 1. ACCESS REQUESTS VIEW                                       */}
      {/* ───────────────────────────────────────────────────────────── */}
      {subTab === 'requests' && (
        <div className="space-y-4">
          {/* Filter Bar */}
          <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-2xs flex flex-wrap gap-3 items-center justify-between">
            <div className="flex flex-wrap gap-2 items-center flex-1">
              {/* Search */}
              <div className="relative min-w-[200px]">
                <Search className="w-4 h-4 text-gray-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  placeholder="Search applicant name, email..."
                  value={requestFilter.search}
                  onChange={e => setRequestFilter({ ...requestFilter, search: e.target.value })}
                  className="w-full text-xs pl-9 pr-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-600"
                />
              </div>

              {/* Status Filter */}
              <select
                value={requestFilter.status}
                onChange={e => setRequestFilter({ ...requestFilter, status: e.target.value })}
                className="text-xs border border-gray-300 rounded-lg px-2.5 py-2 bg-white focus:outline-none"
              >
                <option value="">All Statuses</option>
                <option value="PENDING">Pending Only</option>
                <option value="APPROVED">Approved</option>
                <option value="REJECTED">Rejected</option>
                <option value="CANCELLED">Cancelled</option>
              </select>

              {/* Org Filter */}
              <select
                value={requestFilter.organizationId}
                onChange={e => setRequestFilter({ ...requestFilter, organizationId: e.target.value })}
                className="text-xs border border-gray-300 rounded-lg px-2.5 py-2 bg-white focus:outline-none max-w-[200px]"
              >
                <option value="">All Organizations</option>
                {organizations.map(org => (
                  <option key={org._id} value={org._id}>{org.name}</option>
                ))}
              </select>

              {/* Role Filter */}
              <select
                value={requestFilter.role}
                onChange={e => setRequestFilter({ ...requestFilter, role: e.target.value })}
                className="text-xs border border-gray-300 rounded-lg px-2.5 py-2 bg-white focus:outline-none"
              >
                <option value="">All Roles</option>
                <option value="WORKER">Worker</option>
                <option value="SUPERVISOR">Supervisor</option>
              </select>
            </div>

            <button
              type="button"
              onClick={loadRequests}
              className="px-3 py-2 text-xs font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg flex items-center gap-1.5 transition cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${requestsLoading ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>

          {/* Requests Table */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-2xs overflow-hidden">
            {requestsLoading ? (
              <div className="p-8 text-center text-xs text-gray-500">
                <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-emerald-600" />
                Loading access requests...
              </div>
            ) : requests.length === 0 ? (
              <div className="p-8 text-center text-xs text-gray-500">
                No access requests match the specified criteria.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-gray-50 border-b border-gray-200 uppercase text-[10px] text-gray-500 font-bold tracking-wider">
                    <tr>
                      <th className="px-4 py-3">Applicant</th>
                      <th className="px-4 py-3">Organization</th>
                      <th className="px-4 py-3">Requested Role</th>
                      <th className="px-4 py-3">Submitted</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {requests.map(req => (
                      <tr key={req._id} className="hover:bg-gray-50/70 transition">
                        <td className="px-4 py-3">
                          <div className="font-semibold text-neutral-900">{req.applicantName}</div>
                          <div className="text-[11px] text-gray-500">{req.applicantEmail}</div>
                          {req.message && (
                            <div className="text-[11px] text-gray-400 italic mt-0.5 line-clamp-1">"{req.message}"</div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-700 font-medium">
                          {req.organizationId?.name || 'Unknown'}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded-full font-bold uppercase text-[10px] ${
                            req.requestedRole === 'SUPERVISOR' ? 'bg-purple-100 text-purple-800' : 'bg-blue-100 text-blue-800'
                          }`}>
                            {req.requestedRole}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                          {new Date(req.createdAt).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`px-2.5 py-0.5 rounded-full font-bold uppercase text-[10px] inline-block ${
                            req.status === 'APPROVED' ? 'bg-green-100 text-green-800' :
                            req.status === 'REJECTED' ? 'bg-red-100 text-red-800' :
                            req.status === 'CANCELLED' ? 'bg-gray-100 text-gray-600' :
                            'bg-amber-100 text-amber-800 animate-pulse'
                          }`}>
                            {req.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          {req.status === 'PENDING' ? (
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => openApproveModal(req)}
                                className="px-2.5 py-1 text-xs font-semibold bg-emerald-700 hover:bg-emerald-800 text-white rounded-md transition cursor-pointer flex items-center gap-1 shadow-2xs"
                              >
                                <Check className="w-3 h-3" />
                                <span>Approve</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedRequest(req);
                                  setRejectModalOpen(true);
                                }}
                                className="px-2.5 py-1 text-xs font-semibold bg-red-50 hover:bg-red-100 text-red-700 rounded-md transition cursor-pointer flex items-center gap-1"
                              >
                                <XCircle className="w-3 h-3" />
                                <span>Reject</span>
                              </button>
                            </div>
                          ) : (
                            <span className="text-[11px] text-gray-400">Processed</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────── */}
      {/* 2. ALL STAFF DIRECTORY VIEW                                   */}
      {/* ───────────────────────────────────────────────────────────── */}
      {subTab === 'staff' && (
        <div className="space-y-4">
          {/* Staff Filter Bar */}
          <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-2xs flex flex-wrap gap-3 items-center justify-between">
            <div className="flex flex-wrap gap-2 items-center flex-1">
              <div className="relative min-w-[200px]">
                <Search className="w-4 h-4 text-gray-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  placeholder="Search staff name..."
                  value={staffFilter.search}
                  onChange={e => setStaffFilter({ ...staffFilter, search: e.target.value })}
                  className="w-full text-xs pl-9 pr-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-600"
                />
              </div>

              <select
                value={staffFilter.organizationId}
                onChange={e => setStaffFilter({ ...staffFilter, organizationId: e.target.value })}
                className="text-xs border border-gray-300 rounded-lg px-2.5 py-2 bg-white focus:outline-none max-w-[200px]"
              >
                <option value="">All Organizations</option>
                {organizations.map(org => (
                  <option key={org._id} value={org._id}>{org.name}</option>
                ))}
              </select>

              <select
                value={staffFilter.role}
                onChange={e => setStaffFilter({ ...staffFilter, role: e.target.value })}
                className="text-xs border border-gray-300 rounded-lg px-2.5 py-2 bg-white focus:outline-none"
              >
                <option value="">All Roles</option>
                <option value="WORKER">Worker</option>
                <option value="SUPERVISOR">Supervisor</option>
                <option value="ORG_ADMIN">Org Admin</option>
              </select>

              <select
                value={staffFilter.status}
                onChange={e => setStaffFilter({ ...staffFilter, status: e.target.value })}
                className="text-xs border border-gray-300 rounded-lg px-2.5 py-2 bg-white focus:outline-none"
              >
                <option value="">All Account Statuses</option>
                <option value="AVAILABLE">Active / Available</option>
                <option value="BUSY">Busy</option>
                <option value="OFFLINE">Offline</option>
                <option value="ON_BREAK">On Break</option>
                <option value="DEACTIVATED">Deactivated</option>
              </select>
            </div>

            <button
              type="button"
              onClick={loadStaff}
              className="px-3 py-2 text-xs font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg flex items-center gap-1.5 transition cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${staffLoading ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>

          {/* Staff Table */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-2xs overflow-hidden">
            {staffLoading ? (
              <div className="p-8 text-center text-xs text-gray-500">
                <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-emerald-600" />
                Loading staff directory...
              </div>
            ) : staff.length === 0 ? (
              <div className="p-8 text-center text-xs text-gray-500">
                No staff members found.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-gray-50 border-b border-gray-200 uppercase text-[10px] text-gray-500 font-bold tracking-wider">
                    <tr>
                      <th className="px-4 py-3">Staff Member</th>
                      <th className="px-4 py-3">Organization</th>
                      <th className="px-4 py-3">Role</th>
                      <th className="px-4 py-3">Assignment Scope</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3 text-right">Administrative Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {staff.map(member => (
                      <tr key={member._id} className="hover:bg-gray-50/70 transition">
                        <td className="px-4 py-3">
                          <div className="font-semibold text-neutral-900">{member.name}</div>
                          <div className="text-[11px] text-gray-500">{member.email || member.authUserId}</div>
                        </td>
                        <td className="px-4 py-3 font-medium text-gray-700">
                          {member.organizationId?.name || 'Unassigned'}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded-full font-bold uppercase text-[10px] ${
                            member.role === 'SUPERVISOR' ? 'bg-purple-100 text-purple-800' : 'bg-blue-100 text-blue-800'
                          }`}>
                            {member.role}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-600">
                          <div>Dept: <span className="font-medium text-neutral-900">{member.departmentId?.name || 'All'}</span></div>
                          {member.counterId && (
                            <div className="text-[11px] text-gray-500">Counter: {member.counterId?.name || `Counter ${member.counterId?.counterNumber}`}</div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded-full font-bold uppercase text-[10px] ${
                            member.status === 'DEACTIVATED' ? 'bg-red-100 text-red-800' :
                            member.status === 'BUSY' ? 'bg-amber-100 text-amber-800' :
                            member.status === 'ON_BREAK' ? 'bg-orange-100 text-orange-800' :
                            member.status === 'OFFLINE' ? 'bg-gray-100 text-gray-600' :
                            'bg-green-100 text-green-800'
                          }`}>
                            {member.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1.5">
                            {member.status === 'DEACTIVATED' ? (
                              <button
                                type="button"
                                onClick={() => setActionConfirmModal({
                                  type: 'reactivate',
                                  staffId: member._id,
                                  staffName: member.name
                                })}
                                className="px-2.5 py-1 text-xs font-semibold bg-green-50 hover:bg-green-100 text-green-700 rounded-md transition cursor-pointer"
                              >
                                Reactivate
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setActionConfirmModal({
                                  type: 'deactivate',
                                  staffId: member._id,
                                  staffName: member.name
                                })}
                                className="px-2.5 py-1 text-xs font-semibold bg-amber-50 hover:bg-amber-100 text-amber-700 rounded-md transition cursor-pointer"
                              >
                                Deactivate
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => setActionConfirmModal({
                                type: 'revoke',
                                staffId: member._id,
                                staffName: member.name,
                                orgName: member.organizationId?.name
                              })}
                              className="px-2.5 py-1 text-xs font-semibold bg-red-50 hover:bg-red-100 text-red-700 rounded-md transition cursor-pointer"
                            >
                              Revoke Org Access
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────── */}
      {/* 3. AUDIT HISTORY VIEW                                         */}
      {/* ───────────────────────────────────────────────────────────── */}
      {subTab === 'history' && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-2xs">
          <div className="flex items-center justify-between pb-3 border-b border-gray-100 mb-4">
            <h3 className="text-sm font-bold text-neutral-900">Administrative Audit Trail</h3>
            <button
              type="button"
              onClick={loadHistory}
              className="px-2.5 py-1 text-xs font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md flex items-center gap-1 transition cursor-pointer"
            >
              <RefreshCw className={`w-3 h-3 ${historyLoading ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>

          {historyLoading ? (
            <div className="p-8 text-center text-xs text-gray-500">
              <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-emerald-600" />
              Loading audit logs...
            </div>
          ) : auditLogs.length === 0 ? (
            <div className="p-8 text-center text-xs text-gray-500">
              No audit logs recorded yet.
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {auditLogs.map(log => (
                <div key={log._id} className="py-3 flex items-start justify-between gap-4 text-xs">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold uppercase tracking-wider text-[10px] px-2 py-0.5 rounded bg-gray-100 text-gray-800">
                        {log.action}
                      </span>
                      <span className="text-gray-400">•</span>
                      <span className="text-gray-500">{new Date(log.createdAt).toLocaleString()}</span>
                    </div>
                    <div className="mt-1 text-neutral-800">
                      Actor: <span className="font-semibold">{log.actorEmail || log.actorId}</span>
                      {log.organizationId?.name && (
                        <span className="text-gray-500 ml-2">in {log.organizationId.name}</span>
                      )}
                    </div>
                    {log.details && (
                      <div className="mt-1 text-[11px] text-gray-500 bg-gray-50 p-2 rounded border border-gray-100">
                        {JSON.stringify(log.details)}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────── */}
      {/* APPROVAL MODAL                                                */}
      {/* ───────────────────────────────────────────────────────────── */}
      {approveModalOpen && selectedRequest && (
        <div className="fixed inset-0 z-50 bg-neutral-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-lg w-full p-6 shadow-xl border border-gray-200">
            <h3 className="text-base font-bold text-neutral-900 mb-1">
              Approve Staff Access: {selectedRequest.applicantName}
            </h3>
            <p className="text-xs text-gray-500 mb-4">
              Confirm authoritative organization and assign authorized department/counter scope.
            </p>

            <form onSubmit={handleApproveSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase text-gray-700 mb-1">
                  Target Organization (Authoritative)
                </label>
                <input
                  type="text"
                  value={selectedRequest.organizationId?.name || 'Selected Org'}
                  readOnly
                  className="w-full text-sm border border-gray-300 rounded-lg p-2 bg-gray-50 text-gray-700"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-gray-700 mb-1">
                  Assigned Role *
                </label>
                <select
                  value={approvalData.approvedRole}
                  onChange={e => setApprovalData({ ...approvalData, approvedRole: e.target.value })}
                  className="w-full text-sm border border-gray-300 rounded-lg p-2 bg-white focus:outline-none focus:ring-1 focus:ring-emerald-600"
                  required
                >
                  <option value="WORKER">Worker (Counter Operations)</option>
                  <option value="SUPERVISOR">Supervisor (Department Scope)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-gray-700 mb-1">
                  Assigned Department {approvalData.approvedRole === 'WORKER' ? '*' : '(Optional Scope)'}
                </label>
                <select
                  value={approvalData.departmentId}
                  onChange={e => {
                    const deptId = e.target.value;
                    setApprovalData({ ...approvalData, departmentId: deptId, counterId: '' });
                    loadCounters(deptId);
                  }}
                  className="w-full text-sm border border-gray-300 rounded-lg p-2 bg-white focus:outline-none focus:ring-1 focus:ring-emerald-600"
                  required={approvalData.approvedRole === 'WORKER'}
                >
                  <option value="">-- Select Department --</option>
                  {departmentsForOrg.map(dept => (
                    <option key={dept._id} value={dept._id}>
                      {dept.name} [Room {dept.roomNumber || 'N/A'}]
                    </option>
                  ))}
                </select>
              </div>

              {approvalData.approvedRole === 'WORKER' && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-semibold uppercase text-gray-700">
                      Assigned Counter
                    </label>
                    {approvalData.departmentId && (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setShowQuickAddCounter(!showQuickAddCounter);
                            setQuickCounterError('');
                          }}
                          className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 hover:underline flex items-center gap-1 cursor-pointer"
                        >
                          <Plus className="w-3 h-3" />
                          <span>{showQuickAddCounter ? 'Hide Form' : 'Quick Add Counter'}</span>
                        </button>
                        <span className="text-gray-300">|</span>
                        <button
                          type="button"
                          onClick={() => setLocationManagerOpen(true)}
                          className="text-xs font-semibold text-neutral-600 hover:text-neutral-900 hover:underline flex items-center gap-1 cursor-pointer"
                        >
                          <DoorOpen className="w-3 h-3" />
                          <span>Manage Rooms & Counters</span>
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Inline Quick Add Counter form */}
                  {showQuickAddCounter && approvalData.departmentId && (
                    <div className="p-3 bg-neutral-50 rounded-lg border border-neutral-200 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-neutral-800">Quick-Add Counter to Department</span>
                        <span className="text-[10px] text-neutral-500">Auto-selects on creation</span>
                      </div>
                      {quickCounterError && (
                        <p className="text-xs text-red-600">{quickCounterError}</p>
                      )}
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="block text-[10px] font-semibold text-neutral-600 mb-0.5">Counter # *</label>
                          <input
                            type="number"
                            min="1"
                            value={quickCounterForm.counterNumber}
                            onChange={e => setQuickCounterForm({ ...quickCounterForm, counterNumber: e.target.value })}
                            placeholder="e.g. 1"
                            className="w-full text-xs border border-neutral-300 rounded p-1.5 bg-white"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-semibold text-neutral-600 mb-0.5">Name / Desk</label>
                          <input
                            type="text"
                            value={quickCounterForm.name}
                            onChange={e => setQuickCounterForm({ ...quickCounterForm, name: e.target.value })}
                            placeholder="e.g. Registration Desk"
                            className="w-full text-xs border border-neutral-300 rounded p-1.5 bg-white"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-semibold text-neutral-600 mb-0.5">Room #</label>
                          <input
                            type="text"
                            value={quickCounterForm.roomNumber}
                            onChange={e => setQuickCounterForm({ ...quickCounterForm, roomNumber: e.target.value })}
                            placeholder="e.g. 101"
                            className="w-full text-xs border border-neutral-300 rounded p-1.5 bg-white"
                          />
                        </div>
                      </div>
                      <div className="flex justify-end gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => setShowQuickAddCounter(false)}
                          className="px-2.5 py-1 text-xs text-neutral-600 hover:bg-neutral-200 rounded cursor-pointer"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={handleQuickCreateCounter}
                          disabled={quickCounterSubmitting || !quickCounterForm.counterNumber}
                          className="px-3 py-1 text-xs font-semibold bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white rounded cursor-pointer"
                        >
                          {quickCounterSubmitting ? 'Creating...' : 'Save & Select'}
                        </button>
                      </div>
                    </div>
                  )}

                  <select
                    value={approvalData.counterId}
                    onChange={e => setApprovalData({ ...approvalData, counterId: e.target.value })}
                    className="w-full text-sm border border-gray-300 rounded-lg p-2 bg-white focus:outline-none focus:ring-1 focus:ring-emerald-600"
                  >
                    <option value="">-- General Department Worker (No fixed counter) --</option>
                    {countersForDept.map(counter => (
                      <option key={counter._id} value={counter._id}>
                        {counter.name || `Counter ${counter.counterNumber}`} [Room {counter.roomNumber || 'N/A'}] — {counter.status || (counter.isActive ? 'ACTIVE' : 'INACTIVE')}
                      </option>
                    ))}
                  </select>

                  {countersForDept.length === 0 && approvalData.departmentId && (
                    <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 flex items-center justify-between text-xs text-amber-800">
                      <span>No counters configured yet in this department.</span>
                      <button
                        type="button"
                        onClick={() => setShowQuickAddCounter(true)}
                        className="text-xs font-bold text-amber-900 underline ml-2 cursor-pointer"
                      >
                        + Create Counter Now
                      </button>
                    </div>
                  )}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold uppercase text-gray-700 mb-1">
                  Administrative Notes (Optional)
                </label>
                <textarea
                  rows={2}
                  value={approvalData.notes}
                  onChange={e => setApprovalData({ ...approvalData, notes: e.target.value })}
                  placeholder="Notes about shift, onboarding verification..."
                  className="w-full text-sm border border-gray-300 rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-emerald-600"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setApproveModalOpen(false)}
                  disabled={processingAction}
                  className="px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-100 rounded-lg transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={processingAction}
                  className="px-4 py-2 text-xs font-semibold bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white rounded-lg transition cursor-pointer shadow-xs flex items-center gap-1.5"
                >
                  {processingAction ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  <span>Confirm Approval & Grant Access</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────── */}
      {/* REJECT MODAL                                                  */}
      {/* ───────────────────────────────────────────────────────────── */}
      {rejectModalOpen && selectedRequest && (
        <div className="fixed inset-0 z-50 bg-neutral-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-xl border border-gray-200">
            <h3 className="text-base font-bold text-neutral-900 mb-1">
              Reject Access Request
            </h3>
            <p className="text-xs text-gray-500 mb-4">
              Rejecting will deny staff access to {selectedRequest.applicantName}. They will remain in citizen status.
            </p>

            <form onSubmit={handleRejectSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase text-gray-700 mb-1">
                  Rejection Reason (Optional)
                </label>
                <textarea
                  rows={3}
                  value={rejectionReason}
                  onChange={e => setRejectionReason(e.target.value)}
                  placeholder="Explain why this request is rejected (e.g. invalid department, unauthorized user)..."
                  className="w-full text-sm border border-gray-300 rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-red-600"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setRejectModalOpen(false)}
                  disabled={processingAction}
                  className="px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-100 rounded-lg transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={processingAction}
                  className="px-4 py-2 text-xs font-semibold bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-lg transition cursor-pointer shadow-xs flex items-center gap-1.5"
                >
                  {processingAction ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
                  <span>Confirm Rejection</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────── */}
      {/* CONSEQUENTIAL ACTION CONFIRMATION MODAL                       */}
      {/* ───────────────────────────────────────────────────────────── */}
      {actionConfirmModal && (
        <div className="fixed inset-0 z-50 bg-neutral-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-sm w-full p-6 shadow-xl border border-gray-200">
            <div className="w-10 h-10 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center mb-3">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <h3 className="text-base font-bold text-neutral-900 mb-1">
              Confirm Consequential Action
            </h3>
            <p className="text-xs text-gray-600 mb-4 leading-relaxed">
              Are you sure you want to <strong>{actionConfirmModal.type}</strong> staff member <strong>{actionConfirmModal.staffName}</strong>?
              {actionConfirmModal.type === 'revoke' && (
                <span className="block mt-1 text-red-600">
                  This will remove their authorized access to {actionConfirmModal.orgName}. Historical queue tickets and audit records will remain preserved.
                </span>
              )}
            </p>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setActionConfirmModal(null)}
                disabled={processingAction}
                className="px-3.5 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-100 rounded-lg transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleStaffActionConfirm}
                disabled={processingAction}
                className={`px-3.5 py-2 text-xs font-semibold text-white rounded-lg transition cursor-pointer shadow-xs flex items-center gap-1.5 ${
                  actionConfirmModal.type === 'reactivate' ? 'bg-emerald-700 hover:bg-emerald-800' : 'bg-red-600 hover:bg-red-700'
                }`}
              >
                {processingAction && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                <span>Confirm {actionConfirmModal.type}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Department Location Manager (Rooms & Counters) Modal */}
      {locationManagerOpen && selectedRequest && approvalData.departmentId && (
        <DepartmentLocationManager
          isOpen={locationManagerOpen}
          onClose={() => setLocationManagerOpen(false)}
          organization={{ _id: selectedRequest.organizationId?._id || selectedRequest.organizationId }}
          department={departmentsForOrg.find(d => d._id === approvalData.departmentId)}
          onDepartmentUpdated={async () => {
            if (approvalData.departmentId) {
              await loadCounters(approvalData.departmentId);
            }
          }}
        />
      )}
    </div>
  );
}
