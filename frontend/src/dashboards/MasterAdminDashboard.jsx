import React, { useState, useEffect } from 'react';
import {
  Building2,
  Hospital,
  Landmark,
  Briefcase,
  PlusCircle,
  ShieldCheck,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  Layers,
  GitFork,
  MapPin,
  Key,
  X,
  RefreshCw,
  Sparkles,
  Trash2,
  AlertTriangle,
  FolderTree,
  Edit
} from 'lucide-react';
import {
  getOrganizations,
  createOrganization,
  updateOrganization,
  getDepartments,
  createDepartment,
  deleteOrganization
} from '../services/organizationService';

export default function MasterAdminDashboard() {
  const [organizations, setOrganizations] = useState([]);
  const [departmentsByOrg, setDepartmentsByOrg] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedOrgId, setExpandedOrgId] = useState(null);
  const [copiedKeyId, setCopiedKeyId] = useState(null);

  // Modals state
  const [isOrgModalOpen, setIsOrgModalOpen] = useState(false);
  const [editingOrg, setEditingOrg] = useState(null);
  const [isDeptModalOpen, setIsDeptModalOpen] = useState(false);
  const [targetOrgForDept, setTargetOrgForDept] = useState(null);

  // Form states
  const [orgForm, setOrgForm] = useState({
    name: '',
    type: 'GOVERNMENT',
    address: '',
    status: 'ACTIVE'
  });
  const [deptForm, setDeptForm] = useState({
    name: '',
    prefix: '',
    avgServiceTimeMins: 5,
    subCountersInput: '',
    isEntryLevel: false,
    roomNumber: ''
  });

  const [formSubmitting, setFormSubmitting] = useState(false);
  const [orgModalError, setOrgModalError] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  // Delete organization state
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [orgToDelete, setOrgToDelete] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteModalError, setDeleteModalError] = useState('');

  const handleDeleteOrgConfirm = async () => {
    if (!orgToDelete) return;
    try {
      setIsDeleting(true);
      setDeleteModalError('');
      setErrorMessage('');
      await deleteOrganization(orgToDelete._id);
      await fetchInitialData();
      if (expandedOrgId === orgToDelete._id) {
        setExpandedOrgId(null);
      }
      setSuccessMessage(`Organization "${orgToDelete.name}" has been archived successfully.`);
      setIsDeleteModalOpen(false);
      setOrgToDelete(null);
    } catch (err) {
      console.error('Failed to delete organization:', err);
      let errMsg = err.response?.data?.error || err.message || 'Failed to archive organization';
      if (err.response?.status === 401) {
        errMsg = 'Authentication required: Please sign in as a Master Admin to archive organizations.';
      } else if (err.response?.status === 403) {
        errMsg = 'Forbidden: Only Master Admin accounts have permission to archive organizations.';
      }
      setDeleteModalError(errMsg);
      setErrorMessage(errMsg);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleOpenCreateOrgModal = () => {
    setEditingOrg(null);
    setOrgForm({ name: '', type: 'GOVERNMENT', address: '', status: 'ACTIVE' });
    setOrgModalError('');
    setIsOrgModalOpen(true);
  };

  const handleOpenEditOrgModal = (org) => {
    setEditingOrg(org);
    setOrgForm({
      name: org.name || '',
      type: org.type || 'GOVERNMENT',
      address: org.address || '',
      status: org.status || 'ACTIVE'
    });
    setOrgModalError('');
    setIsOrgModalOpen(true);
  };

  useEffect(() => {
    fetchInitialData();
  }, []);

  const fetchInitialData = async () => {
    try {
      setLoading(true);
      setErrorMessage('');
      const orgs = await getOrganizations();
      setOrganizations(orgs);

      const deptMap = {};
      await Promise.all(
        orgs.map(async (org) => {
          try {
            const depts = await getDepartments(org._id);
            deptMap[org._id] = depts;
          } catch (e) {
            deptMap[org._id] = [];
          }
        })
      );
      setDepartmentsByOrg(deptMap);

      if (orgs.length > 0 && !expandedOrgId) {
        setExpandedOrgId(orgs[0]._id);
      }
    } catch (err) {
      console.error('Failed to load organizations:', err);
      setErrorMessage('Could not load organizations. Please ensure backend server is active.');
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchInitialData();
    setRefreshing(false);
  };

  const toggleExpandOrg = async (orgId) => {
    if (expandedOrgId === orgId) {
      setExpandedOrgId(null);
      return;
    }

    setExpandedOrgId(orgId);
    if (!departmentsByOrg[orgId]) {
      try {
        const depts = await getDepartments(orgId);
        setDepartmentsByOrg((prev) => ({ ...prev, [orgId]: depts }));
      } catch (err) {
        console.error('Failed to load departments for org:', err);
      }
    }
  };

  const handleCopyApiKey = (apiKey, orgId) => {
    if (!apiKey) return;
    navigator.clipboard.writeText(apiKey);
    setCopiedKeyId(orgId);
    setTimeout(() => setCopiedKeyId(null), 2500);
  };

  const handleSaveOrgSubmit = async (e) => {
    e.preventDefault();
    if (!orgForm.name.trim()) {
      setOrgModalError('Organization name is required');
      return;
    }

    try {
      setFormSubmitting(true);
      setOrgModalError('');
      setErrorMessage('');

      if (editingOrg) {
        const res = await updateOrganization(editingOrg._id, orgForm);
        const updatedOrg = res.organization || res;
        await fetchInitialData();
        setIsOrgModalOpen(false);
        setEditingOrg(null);
        setSuccessMessage(`Organization "${updatedOrg.name}" updated successfully!`);
      } else {
        const res = await createOrganization(orgForm);
        const newOrg = res.organization || res;
        await fetchInitialData();
        setExpandedOrgId(newOrg._id);
        setIsOrgModalOpen(false);
        setSuccessMessage(`Organization "${newOrg.name}" created successfully!`);
      }
      setTimeout(() => setSuccessMessage(''), 4000);
    } catch (err) {
      console.error('Error saving organization:', err);
      const errMsg = err.response?.data?.error || err.message || 'Failed to save organization';
      setOrgModalError(errMsg);
      setErrorMessage(errMsg);
    } finally {
      setFormSubmitting(false);
    }
  };

  const handleOpenAddDeptModal = (org) => {
    setTargetOrgForDept(org);
    const existingDepts = departmentsByOrg[org._id] || [];
    setDeptForm({
      name: '',
      prefix: '',
      avgServiceTimeMins: 5,
      subCountersInput: 'Desk 1, Desk 2',
      isEntryLevel: existingDepts.length === 0,
      roomNumber: ''
    });
    setIsDeptModalOpen(true);
  };

  const handleCreateDeptSubmit = async (e) => {
    e.preventDefault();
    if (!targetOrgForDept || !deptForm.name.trim() || !deptForm.prefix.trim()) return;

    try {
      setFormSubmitting(true);
      setErrorMessage('');

      const subCounters = deptForm.subCountersInput
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      const deptPayload = {
        name: deptForm.name.trim(),
        prefix: deptForm.prefix.trim().toUpperCase(),
        avgServiceTimeMins: Number(deptForm.avgServiceTimeMins) || 5,
        subCounters,
        isEntryLevel: Boolean(deptForm.isEntryLevel),
        roomNumber: deptForm.roomNumber ? deptForm.roomNumber.trim() : ''
      };

      const res = await createDepartment(targetOrgForDept._id, deptPayload);
      const newDept = res.department || res;

      setDepartmentsByOrg((prev) => {
        const existing = prev[targetOrgForDept._id] || [];
        const updated = newDept.isEntryLevel
          ? [newDept, ...existing]
          : [...existing, newDept];
        return { ...prev, [targetOrgForDept._id]: updated };
      });

      setIsDeptModalOpen(false);
      setSuccessMessage(`Department "${newDept.name}" added to ${targetOrgForDept.name}!`);
      setTimeout(() => setSuccessMessage(''), 4000);
    } catch (err) {
      console.error('Error creating department:', err);
      setErrorMessage(err.response?.data?.error || err.message || 'Failed to create department');
    } finally {
      setFormSubmitting(false);
    }
  };

  const renderTypeBadge = (type) => {
    switch (type) {
      case 'HOSPITAL':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-800 border border-blue-200">
            <Hospital className="w-3.5 h-3.5" /> Hospital
          </span>
        );
      case 'GOVERNMENT':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200">
            <Landmark className="w-3.5 h-3.5" /> Government
          </span>
        );
      case 'PRIVATE':
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-neutral-100 text-neutral-800 border border-neutral-200">
            <Briefcase className="w-3.5 h-3.5" /> Private
          </span>
        );
    }
  };

  const totalOrgs = organizations.length;
  const allDepts = Object.values(departmentsByOrg).flat();
  const totalDepts = allDepts.length;
  const totalEntryLevel = allDepts.filter((d) => d.isEntryLevel).length;

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6 bg-white min-h-screen text-neutral-900 font-sans">
      
      {/* ── Header ── */}
      <div className="border border-neutral-200 rounded-xl p-5 bg-white shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-xl font-bold text-neutral-900">
              Master Admin Dashboard
            </h1>
            <span className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs px-2.5 py-0.5 rounded-full font-semibold flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5" /> Admin
            </span>
          </div>
          <p className="text-xs text-neutral-500">
            Create, view, manage, and archive organizations and their service departments
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="p-2.5 bg-neutral-50 border border-neutral-200 hover:bg-neutral-100 text-neutral-700 text-xs font-semibold rounded-lg transition"
            title="Refresh list"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>

          <button
            onClick={handleOpenCreateOrgModal}
            className="flex items-center gap-1.5 bg-emerald-700 hover:bg-emerald-800 active:bg-emerald-900 text-white text-xs font-bold py-2.5 px-4 rounded-lg transition shadow-sm"
          >
            <PlusCircle className="w-4 h-4" />
            <span>Create Organization</span>
          </button>
        </div>
      </div>

      {/* ── Summary Stats Bar ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-neutral-50 border border-neutral-200 rounded-xl p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-700">
            <Building2 className="w-5 h-5" />
          </div>
          <div>
            <div className="text-2xl font-black text-neutral-900 font-mono">{totalOrgs}</div>
            <div className="text-xs text-neutral-500 font-medium">Total Organizations</div>
          </div>
        </div>

        <div className="bg-neutral-50 border border-neutral-200 rounded-xl p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-neutral-100 border border-neutral-200 flex items-center justify-center text-neutral-700">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <div className="text-2xl font-black text-neutral-900 font-mono">{totalDepts}</div>
            <div className="text-xs text-neutral-500 font-medium">Total Departments</div>
          </div>
        </div>

        <div className="bg-neutral-50 border border-neutral-200 rounded-xl p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-700">
            <GitFork className="w-5 h-5" />
          </div>
          <div>
            <div className="text-2xl font-black text-neutral-900 font-mono">{totalEntryLevel}</div>
            <div className="text-xs text-neutral-500 font-medium">Entry-Level Reception Tiers</div>
          </div>
        </div>
      </div>

      {/* ── Alerts & Notifications ── */}
      {successMessage && (
        <div className="p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-emerald-700 shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      {errorMessage && (
        <div className="p-3.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-900 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-700 shrink-0" />
            <span>{errorMessage}</span>
          </div>
          <button onClick={() => setErrorMessage('')} className="text-rose-700 hover:text-rose-900">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ── Organization Cards List ── */}
      {loading ? (
        <div className="border border-neutral-200 rounded-xl p-12 text-center text-neutral-500 flex flex-col items-center gap-2 bg-neutral-50">
          <RefreshCw className="w-6 h-6 animate-spin text-neutral-400" />
          <span className="text-xs">Loading organizations...</span>
        </div>
      ) : organizations.length === 0 ? (
        <div className="border border-neutral-200 rounded-xl p-12 text-center text-neutral-500 flex flex-col items-center gap-3 bg-neutral-50">
          <Building2 className="w-10 h-10 text-neutral-400" />
          <div>
            <h3 className="text-sm font-bold text-neutral-800">No Organizations Found</h3>
            <p className="text-xs text-neutral-500 mt-1">Create your first organization to configure queues and departments.</p>
          </div>
          <button
            onClick={() => setIsOrgModalOpen(true)}
            className="mt-2 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold py-2 px-4 rounded-lg transition"
          >
            Create Organization
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {organizations.map((org) => {
            const depts = departmentsByOrg[org._id] || [];
            const isExpanded = expandedOrgId === org._id;

            return (
              <div
                key={org._id}
                className="border border-neutral-200 rounded-xl bg-white shadow-sm overflow-hidden"
              >
                {/* Organization Row */}
                <div className="p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-lg bg-neutral-100 border border-neutral-200 flex items-center justify-center shrink-0 text-neutral-700">
                      {org.type === 'HOSPITAL' ? (
                        <Hospital className="w-5 h-5 text-blue-700" />
                      ) : org.type === 'GOVERNMENT' ? (
                        <Landmark className="w-5 h-5 text-amber-700" />
                      ) : (
                        <Building2 className="w-5 h-5 text-neutral-700" />
                      )}
                    </div>

                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-base font-bold text-neutral-900">{org.name}</h2>
                        {renderTypeBadge(org.type)}
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                          {org.status || 'ACTIVE'}
                        </span>
                      </div>

                      {org.address && (
                        <div className="flex items-center gap-1 text-xs text-neutral-500">
                          <MapPin className="w-3.5 h-3.5 text-neutral-400" />
                          <span>{org.address}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {/* API Key */}
                    {org.apiKey && (
                      <div
                        onClick={() => handleCopyApiKey(org.apiKey, org._id)}
                        className="flex items-center gap-1.5 bg-neutral-50 border border-neutral-200 px-2.5 py-1.5 rounded-lg cursor-pointer hover:bg-neutral-100 transition text-xs text-neutral-700"
                        title="Click to copy API Key"
                      >
                        <Key className="w-3 h-3 text-neutral-500" />
                        <span className="font-mono text-[11px]">
                          {org.apiKey.slice(0, 6)}••••
                        </span>
                        {copiedKeyId === org._id ? (
                          <Check className="w-3 h-3 text-emerald-600" />
                        ) : (
                          <Copy className="w-3 h-3 text-neutral-400" />
                        )}
                      </div>
                    )}

                    <span className="px-2.5 py-1.5 bg-neutral-100 text-neutral-700 text-xs font-medium rounded-lg border border-neutral-200">
                      {depts.length} {depts.length === 1 ? 'Dept' : 'Depts'}
                    </span>

                    {/* Manage / Toggle */}
                    <button
                      onClick={() => toggleExpandOrg(org._id)}
                      className="inline-flex items-center gap-1 bg-neutral-100 hover:bg-neutral-200 text-neutral-800 text-xs font-semibold px-3 py-1.5 rounded-lg border border-neutral-200 transition"
                    >
                      <span>{isExpanded ? 'Hide' : 'Manage'}</span>
                      {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </button>

                    {/* Edit */}
                    <button
                      onClick={() => handleOpenEditOrgModal(org)}
                      className="inline-flex items-center gap-1 bg-white hover:bg-neutral-100 text-neutral-800 text-xs font-semibold px-3 py-1.5 rounded-lg border border-neutral-200 transition"
                      title="Edit Organization Details"
                    >
                      <Edit className="w-3.5 h-3.5 text-neutral-600" />
                      <span>Edit</span>
                    </button>

                    {/* Delete / Archive */}
                    <button
                      onClick={() => {
                        setOrgToDelete(org);
                        setDeleteModalError('');
                        setIsDeleteModalOpen(true);
                      }}
                      className="inline-flex items-center gap-1 bg-white hover:bg-rose-50 text-rose-700 text-xs font-semibold px-3 py-1.5 rounded-lg border border-rose-200 transition"
                      title="Delete or Archive Organization"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Archive</span>
                    </button>
                  </div>
                </div>

                {/* Expanded Section */}
                {isExpanded && (
                  <div className="border-t border-neutral-200 bg-neutral-50 p-5 space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-neutral-200">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-neutral-700 uppercase tracking-wider">
                        <FolderTree className="w-4 h-4 text-emerald-700" />
                        <span>Configured Departments & Services</span>
                      </div>

                      <button
                        onClick={() => handleOpenAddDeptModal(org)}
                        className="inline-flex items-center gap-1 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold py-1.5 px-3 rounded-lg transition"
                      >
                        <PlusCircle className="w-3.5 h-3.5" />
                        <span>Add Department</span>
                      </button>
                    </div>

                    {depts.length === 0 ? (
                      <div className="p-6 text-center text-xs text-neutral-500 bg-white rounded-lg border border-dashed border-neutral-200">
                        No departments created yet for this organization.
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {depts.map((d) => (
                          <div
                            key={d._id}
                            className="p-3 bg-white border border-neutral-200 rounded-lg flex items-center justify-between text-xs"
                          >
                            <div>
                              <div className="font-bold text-neutral-900 flex items-center gap-1.5">
                                <span>{d.name}</span>
                                <span className="font-mono text-neutral-500 text-[11px]">({d.prefix})</span>
                                {d.isEntryLevel && (
                                  <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-50 text-emerald-800 border border-emerald-200 font-semibold">
                                    Entry Level
                                  </span>
                                )}
                              </div>
                              <div className="text-neutral-500 text-[11px] mt-0.5">
                                {d.roomNumber ? `Room ${d.roomNumber} · ` : ''}Avg {d.avgServiceTimeMins || 5} min
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Modal: Create / Edit Organization ── */}
      {isOrgModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
          <div className="bg-white border border-neutral-200 rounded-xl max-w-md w-full p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-neutral-100">
              <h3 className="font-bold text-base text-neutral-900">
                {editingOrg ? 'Edit Organization' : 'Create New Organization'}
              </h3>
              <button
                onClick={() => {
                  setIsOrgModalOpen(false);
                  setEditingOrg(null);
                }}
                className="text-neutral-400 hover:text-neutral-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {orgModalError && (
              <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-700 shrink-0" />
                <span>{orgModalError}</span>
              </div>
            )}

            <form onSubmit={handleSaveOrgSubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">Organization Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. City General Hospital, District Registry"
                  value={orgForm.name}
                  onChange={(e) => setOrgForm({ ...orgForm, name: e.target.value })}
                  className="w-full bg-white border border-neutral-200 rounded-lg px-3 py-2 text-xs text-neutral-900 focus:outline-none focus:ring-1 focus:ring-emerald-700"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">Type *</label>
                <select
                  value={orgForm.type}
                  onChange={(e) => setOrgForm({ ...orgForm, type: e.target.value })}
                  className="w-full bg-white border border-neutral-200 rounded-lg px-3 py-2 text-xs text-neutral-900 focus:outline-none focus:ring-1 focus:ring-emerald-700"
                >
                  <option value="GOVERNMENT">Government Office</option>
                  <option value="HOSPITAL">Hospital / Clinic</option>
                  <option value="PRIVATE">Private Enterprise</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">Address / Location</label>
                <input
                  type="text"
                  placeholder="e.g. Building 4, Central Avenue"
                  value={orgForm.address}
                  onChange={(e) => setOrgForm({ ...orgForm, address: e.target.value })}
                  className="w-full bg-white border border-neutral-200 rounded-lg px-3 py-2 text-xs text-neutral-900 focus:outline-none focus:ring-1 focus:ring-emerald-700"
                />
              </div>

              {editingOrg && (
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Status</label>
                  <select
                    value={orgForm.status}
                    onChange={(e) => setOrgForm({ ...orgForm, status: e.target.value })}
                    className="w-full bg-white border border-neutral-200 rounded-lg px-3 py-2 text-xs text-neutral-900 focus:outline-none focus:ring-1 focus:ring-emerald-700"
                  >
                    <option value="ACTIVE">ACTIVE</option>
                    <option value="INACTIVE">INACTIVE</option>
                    <option value="SUSPENDED">SUSPENDED</option>
                  </select>
                </div>
              )}

              <div className="pt-3 flex justify-end gap-2 border-t border-neutral-100">
                <button
                  type="button"
                  onClick={() => {
                    setIsOrgModalOpen(false);
                    setEditingOrg(null);
                  }}
                  className="px-4 py-2 text-xs font-medium text-neutral-600 hover:bg-neutral-100 rounded-lg transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={formSubmitting}
                  className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition"
                >
                  {formSubmitting
                    ? (editingOrg ? 'Saving...' : 'Creating...')
                    : (editingOrg ? 'Save Changes' : 'Create Organization')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal: Add Department ── */}
      {isDeptModalOpen && targetOrgForDept && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
          <div className="bg-white border border-neutral-200 rounded-xl max-w-md w-full p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-neutral-100">
              <div>
                <h3 className="font-bold text-base text-neutral-900">Add Department</h3>
                <p className="text-xs text-neutral-500">To {targetOrgForDept.name}</p>
              </div>
              <button onClick={() => setIsDeptModalOpen(false)} className="text-neutral-400 hover:text-neutral-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateDeptSubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">Department Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Registration, Triage, Cashier"
                  value={deptForm.name}
                  onChange={(e) => setDeptForm({ ...deptForm, name: e.target.value })}
                  className="w-full bg-white border border-neutral-200 rounded-lg px-3 py-2 text-xs text-neutral-900 focus:outline-none focus:ring-1 focus:ring-emerald-700"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Ticket Prefix *</label>
                  <input
                    type="text"
                    required
                    maxLength={5}
                    placeholder="e.g. REG, TRI"
                    value={deptForm.prefix}
                    onChange={(e) => setDeptForm({ ...deptForm, prefix: e.target.value.toUpperCase() })}
                    className="w-full bg-white border border-neutral-200 rounded-lg px-3 py-2 text-xs font-mono uppercase text-neutral-900 focus:outline-none focus:ring-1 focus:ring-emerald-700"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Room / Counter</label>
                  <input
                    type="text"
                    placeholder="e.g. 101, Desk A"
                    value={deptForm.roomNumber}
                    onChange={(e) => setDeptForm({ ...deptForm, roomNumber: e.target.value })}
                    className="w-full bg-white border border-neutral-200 rounded-lg px-3 py-2 text-xs text-neutral-900 focus:outline-none focus:ring-1 focus:ring-emerald-700"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">Avg Service Time (mins)</label>
                <input
                  type="number"
                  min="1"
                  value={deptForm.avgServiceTimeMins}
                  onChange={(e) => setDeptForm({ ...deptForm, avgServiceTimeMins: e.target.value })}
                  className="w-full bg-white border border-neutral-200 rounded-lg px-3 py-2 text-xs text-neutral-900 focus:outline-none focus:ring-1 focus:ring-emerald-700"
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="isEntryLevel"
                  checked={deptForm.isEntryLevel}
                  onChange={(e) => setDeptForm({ ...deptForm, isEntryLevel: e.target.checked })}
                  className="rounded border-neutral-300 text-emerald-700 focus:ring-emerald-700"
                />
                <label htmlFor="isEntryLevel" className="text-xs text-neutral-700 font-medium cursor-pointer">
                  Entry-level department (Initial citizen check-in)
                </label>
              </div>

              <div className="pt-3 flex justify-end gap-2 border-t border-neutral-100">
                <button
                  type="button"
                  onClick={() => setIsDeptModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-neutral-600 hover:bg-neutral-100 rounded-lg transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={formSubmitting}
                  className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition"
                >
                  {formSubmitting ? 'Adding...' : 'Add Department'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Confirmation Modal: Archive / Delete Organization ── */}
      {isDeleteModalOpen && orgToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
          <div className="bg-white border border-neutral-200 rounded-xl max-w-md w-full p-6 shadow-xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-rose-50 border border-rose-200 flex items-center justify-center text-rose-700 shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-base text-neutral-900">Archive Organization?</h3>
                <p className="text-xs text-neutral-500">Please confirm organization deletion</p>
              </div>
            </div>

            <p className="text-xs text-neutral-600 leading-relaxed">
              Are you sure you want to archive/delete <strong>"{orgToDelete.name}"</strong>? This will safely mark the organization as deleted and prevent new tickets from being created.
            </p>

            {deleteModalError && (
              <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-700 shrink-0" />
                <span>{deleteModalError}</span>
              </div>
            )}

            <div className="pt-3 flex justify-end gap-2 border-t border-neutral-100">
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => {
                  setIsDeleteModalOpen(false);
                  setOrgToDelete(null);
                }}
                className="px-4 py-2 text-xs font-medium text-neutral-600 hover:bg-neutral-100 rounded-lg transition"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={handleDeleteOrgConfirm}
                className="px-4 py-2 bg-rose-700 hover:bg-rose-800 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition flex items-center gap-1.5"
              >
                {isDeleting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                <span>{isDeleting ? 'Archiving...' : 'Confirm Archive / Delete'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}