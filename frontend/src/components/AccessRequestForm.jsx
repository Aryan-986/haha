import React, { useState, useEffect } from 'react';
import { useUser } from '@clerk/clerk-react';
import { Shield, Clock, Send, AlertCircle, CheckCircle, XCircle, Building2, UserCheck, RefreshCw } from 'lucide-react';
import { getOrganizations } from '../services/organizationService';
import { submitAccessRequest, getMyAccessRequests, cancelAccessRequest } from '../services/accessRequestService';

export default function AccessRequestForm({ onStatusChange }) {
  const { user } = useUser();
  const [organizations, setOrganizations] = useState([]);
  const [myRequests, setMyRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);

  const [formData, setFormData] = useState({
    organizationId: '',
    requestedRole: 'WORKER',
    applicantName: user?.fullName || [user?.firstName, user?.lastName].filter(Boolean).join(' ') || '',
    applicantEmail: user?.primaryEmailAddress?.emailAddress || '',
    message: ''
  });

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const [orgs, requestsRes] = await Promise.all([
        getOrganizations().catch(() => []),
        getMyAccessRequests().catch(() => ({ requests: [] }))
      ]);
      setOrganizations(Array.isArray(orgs) ? orgs : []);
      setMyRequests(requestsRes.requests || []);
      if (orgs.length > 0 && !formData.organizationId) {
        setFormData(prev => ({ ...prev, organizationId: orgs[0]._id }));
      }
    } catch (err) {
      setError('Failed to load available organizations.');
    } finally {
      setLoading(false);
    }
  }

  const pendingRequest = myRequests.find(r => r.status === 'PENDING');

  async function handleSubmit(e) {
    e.preventDefault();
    if (!formData.organizationId) {
      setError('Please select an organization.');
      return;
    }

    setSubmitting(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const result = await submitAccessRequest(formData);
      setSuccessMsg('Your access request has been submitted for Master Admin review.');
      await loadData();
      if (onStatusChange) onStatusChange();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to submit request.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancel(requestId) {
    if (!confirm('Are you sure you want to cancel this access request?')) return;
    try {
      await cancelAccessRequest(requestId);
      await loadData();
      if (onStatusChange) onStatusChange();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to cancel request.');
    }
  }

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto my-12 p-8 bg-white border border-gray-200 rounded-xl shadow-xs text-center">
        <RefreshCw className="w-8 h-8 text-emerald-600 animate-spin mx-auto mb-3" />
        <p className="text-gray-600 text-sm">Loading staff authorization status...</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto my-8 px-4">
      {/* Header Banner */}
      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-6 mb-6">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-lg bg-emerald-600 text-white flex items-center justify-center shrink-0">
            <Shield className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-emerald-950">Staff Access & Onboarding</h2>
            <p className="text-xs sm:text-sm text-emerald-800 mt-1 leading-relaxed">
              QueueLess operates on a strict zero-trust permission model. Creating an account does not automatically grant staff privileges.
              Submit your request to join an organization as a Worker or Supervisor. The Master Admin (<span className="font-semibold text-emerald-900">aryankarki984@gmail.com</span>) must verify and approve your assignment.
            </p>
          </div>
        </div>
      </div>

      {/* Messages */}
      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-3 text-red-800 text-sm">
          <AlertCircle className="w-5 h-5 shrink-0 text-red-600" />
          <span>{error}</span>
        </div>
      )}

      {successMsg && (
        <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg flex items-center gap-3 text-green-800 text-sm">
          <CheckCircle className="w-5 h-5 shrink-0 text-green-600" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Active Pending Request Card */}
      {pendingRequest ? (
        <div className="bg-white border-2 border-amber-300 rounded-xl p-6 shadow-xs mb-6">
          <div className="flex items-center justify-between gap-4 mb-4">
            <div className="flex items-center gap-2 text-amber-800 font-bold text-base">
              <Clock className="w-5 h-5 text-amber-600 animate-pulse" />
              <span>Access Request Pending Review</span>
            </div>
            <span className="px-2.5 py-1 text-xs font-bold uppercase rounded-full bg-amber-100 text-amber-800">
              Pending
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm text-gray-700 bg-amber-50/60 p-4 rounded-lg mb-4">
            <div>
              <span className="text-xs text-gray-500 uppercase tracking-wider block">Organization</span>
              <span className="font-semibold">{pendingRequest.organizationId?.name || 'Selected Organization'}</span>
            </div>
            <div>
              <span className="text-xs text-gray-500 uppercase tracking-wider block">Requested Role</span>
              <span className="font-semibold">{pendingRequest.requestedRole}</span>
            </div>
            <div>
              <span className="text-xs text-gray-500 uppercase tracking-wider block">Applicant</span>
              <span>{pendingRequest.applicantName} ({pendingRequest.applicantEmail})</span>
            </div>
            <div>
              <span className="text-xs text-gray-500 uppercase tracking-wider block">Submitted At</span>
              <span>{new Date(pendingRequest.createdAt).toLocaleString()}</span>
            </div>
          </div>

          <p className="text-xs text-gray-600 mb-4">
            Your request is awaiting review by the Master Admin. You cannot access the operational staff dashboard until this request is approved and your department and counter assignment are confirmed.
          </p>

          <div className="flex items-center justify-between gap-3 pt-2 border-t border-gray-100">
            <button
              type="button"
              onClick={() => loadData()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md transition cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Check Status
            </button>
            <button
              type="button"
              onClick={() => handleCancel(pendingRequest._id)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 rounded-md transition cursor-pointer"
            >
              <XCircle className="w-3.5 h-3.5" />
              Cancel Request
            </button>
          </div>
        </div>
      ) : (
        /* Submission Form */
        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-xs">
          <h3 className="text-base font-bold text-neutral-900 mb-1">Submit Access Request</h3>
          <p className="text-xs text-gray-500 mb-5">
            Select the organization and the role you are authorized to operate.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold uppercase text-gray-700 mb-1">
                Target Organization *
              </label>
              <select
                value={formData.organizationId}
                onChange={e => setFormData({ ...formData, organizationId: e.target.value })}
                className="w-full text-sm border border-gray-300 rounded-lg p-2.5 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-600"
                required
              >
                <option value="">-- Select an Organization --</option>
                {organizations.map(org => (
                  <option key={org._id} value={org._id}>
                    {org.name} ({org.type || 'Government'})
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold uppercase text-gray-700 mb-1">
                  Requested Role *
                </label>
                <select
                  value={formData.requestedRole}
                  onChange={e => setFormData({ ...formData, requestedRole: e.target.value })}
                  className="w-full text-sm border border-gray-300 rounded-lg p-2.5 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  required
                >
                  <option value="WORKER">Worker (Counter Operations)</option>
                  <option value="SUPERVISOR">Supervisor (Department Queue Oversight)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-gray-700 mb-1">
                  Full Name *
                </label>
                <input
                  type="text"
                  value={formData.applicantName}
                  onChange={e => setFormData({ ...formData, applicantName: e.target.value })}
                  className="w-full text-sm border border-gray-300 rounded-lg p-2.5 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase text-gray-700 mb-1">
                Official Email Address *
              </label>
              <input
                type="email"
                value={formData.applicantEmail}
                onChange={e => setFormData({ ...formData, applicantEmail: e.target.value })}
                className="w-full text-sm border border-gray-300 rounded-lg p-2.5 bg-gray-50 focus:outline-none"
                readOnly
              />
              <p className="text-[11px] text-gray-500 mt-1">Derives automatically from your authenticated Clerk session.</p>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase text-gray-700 mb-1">
                Statement / Service Justification (Optional)
              </label>
              <textarea
                rows={3}
                value={formData.message}
                onChange={e => setFormData({ ...formData, message: e.target.value })}
                placeholder="E.g. Department assignment, employee ID, shift schedule..."
                className="w-full text-sm border border-gray-300 rounded-lg p-2.5 focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2.5 px-4 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white font-semibold text-sm rounded-lg transition flex items-center justify-center gap-2 cursor-pointer shadow-xs"
            >
              {submitting ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Submitting Request...</span>
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  <span>Submit Request for Master Admin Approval</span>
                </>
              )}
            </button>
          </form>
        </div>
      )}

      {/* Historical Requests Section */}
      {myRequests.length > 0 && (
        <div className="mt-8 bg-white border border-gray-200 rounded-xl p-5 shadow-xs">
          <h4 className="text-xs font-bold uppercase tracking-wider text-gray-700 mb-3">Your Request History</h4>
          <div className="divide-y divide-gray-100">
            {myRequests.map(req => (
              <div key={req._id} className="py-2.5 flex items-center justify-between text-xs">
                <div>
                  <span className="font-semibold text-neutral-900">{req.organizationId?.name}</span>
                  <span className="text-gray-500 ml-2">({req.requestedRole})</span>
                  <span className="text-gray-400 block sm:inline sm:ml-2">{new Date(req.createdAt).toLocaleDateString()}</span>
                  {req.rejectionReason && (
                    <p className="text-red-700 mt-1">Reason: {req.rejectionReason}</p>
                  )}
                </div>
                <div>
                  <span className={`px-2 py-0.5 rounded-full font-bold uppercase text-[10px] ${
                    req.status === 'APPROVED' ? 'bg-green-100 text-green-800' :
                    req.status === 'REJECTED' ? 'bg-red-100 text-red-800' :
                    req.status === 'CANCELLED' ? 'bg-gray-100 text-gray-700' :
                    'bg-amber-100 text-amber-800'
                  }`}>
                    {req.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
