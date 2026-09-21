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
  Clock,
  Layers,
  GitFork,
  MapPin,
  Key,
  X,
  ArrowRight,
  RefreshCw,
  Sparkles,
  Tag
} from 'lucide-react';
import {
  getOrganizations,
  createOrganization,
  getDepartments,
  createDepartment
} from '../services/organizationService';

export default function MasterAdminDashboard() {
  // State for organizations and department caches
  const [organizations, setOrganizations] = useState([]);
  const [departmentsByOrg, setDepartmentsByOrg] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedOrgId, setExpandedOrgId] = useState(null);
  const [copiedKeyId, setCopiedKeyId] = useState(null);

  // Modals state
  const [isOrgModalOpen, setIsOrgModalOpen] = useState(false);
  const [isDeptModalOpen, setIsDeptModalOpen] = useState(false);
  const [targetOrgForDept, setTargetOrgForDept] = useState(null);

  // Form states
  const [orgForm, setOrgForm] = useState({
    name: '',
    type: 'GOVERNMENT',
    address: ''
  });
  const [deptForm, setDeptForm] = useState({
    name: '',
    prefix: '',
    avgServiceTimeMins: 5,
    subCountersInput: '',
    isEntryLevel: false
  });

  const [formSubmitting, setFormSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  // Initial load
  useEffect(() => {
    fetchInitialData();
  }, []);

  const fetchInitialData = async () => {
    try {
      setLoading(true);
      setErrorMessage('');
      const orgs = await getOrganizations();
      setOrganizations(orgs);

      // Auto-load departments for all organizations in parallel to compute counts
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

      // Automatically expand first organization if available
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

  // Toggle card expansion and load departments if not already loaded
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

  // Copy API key to clipboard with visual confirmation
  const handleCopyApiKey = (apiKey, orgId) => {
    if (!apiKey) return;
    navigator.clipboard.writeText(apiKey);
    setCopiedKeyId(orgId);
    setTimeout(() => setCopiedKeyId(null), 2500);
  };

  // Submit new Organization
  const handleCreateOrgSubmit = async (e) => {
    e.preventDefault();
    if (!orgForm.name.trim()) return;

    try {
      setFormSubmitting(true);
      setErrorMessage('');

      const res = await createOrganization(orgForm);
      const newOrg = res.organization || res;

      // Reactively update state
      setOrganizations((prev) => [newOrg, ...prev]);
      setDepartmentsByOrg((prev) => ({ ...prev, [newOrg._id]: [] }));
      setExpandedOrgId(newOrg._id);

      // Reset & close modal
      setOrgForm({ name: '', type: 'GOVERNMENT', address: '' });
      setIsOrgModalOpen(false);
      setSuccessMessage(`Organization "${newOrg.name}" created successfully!`);
      setTimeout(() => setSuccessMessage(''), 4000);
    } catch (err) {
      console.error('Error creating organization:', err);
      setErrorMessage(err.response?.data?.error || err.message || 'Failed to create organization');
    } finally {
      setFormSubmitting(false);
    }
  };

  // Open Add Department modal for a specific organization
  const handleOpenAddDeptModal = (org) => {
    setTargetOrgForDept(org);
    const existingDepts = departmentsByOrg[org._id] || [];
    // Default isEntryLevel to true if this is the first department
    setDeptForm({
      name: '',
      prefix: '',
      avgServiceTimeMins: 5,
      subCountersInput: 'Desk 1, Desk 2',
      isEntryLevel: existingDepts.length === 0
    });
    setIsDeptModalOpen(true);
  };

  // Submit new Department
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
        isEntryLevel: Boolean(deptForm.isEntryLevel)
      };

      const res = await createDepartment(targetOrgForDept._id, deptPayload);
      const newDept = res.department || res;

      // Reactively update departments list in state for this organization
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

  // Helper to render type badge
  const renderTypeBadge = (type) => {
    switch (type) {
      case 'HOSPITAL':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
            <Hospital className="w-3.5 h-3.5" /> Hospital
          </span>
        );
      case 'GOVERNMENT':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <Landmark className="w-3.5 h-3.5" /> Government
          </span>
        );
      case 'PRIVATE':
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-purple-500/10 text-purple-400 border border-purple-500/20">
            <Briefcase className="w-3.5 h-3.5" /> Private
          </span>
        );
    }
  };

  // Compute total counts
  const totalOrgs = organizations.length;
  const allDepts = Object.values(departmentsByOrg).flat();
  const totalDepts = allDepts.length;
  const totalEntryLevel = allDepts.filter((d) => d.isEntryLevel).length;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900/80 border border-slate-800 backdrop-blur-xl rounded-2xl p-6 shadow-2xl">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-black tracking-tight text-white">
              Master Admin Hierarchy Portal
            </h1>
            <span className="bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 text-xs px-3 py-1 rounded-full font-bold flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5" /> Super Admin
            </span>
          </div>
          <p className="text-xs text-slate-400">
            Manage multi-tenant institutions, dynamic counter tiers, and multi-stage token transition workflows.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold py-2.5 px-3.5 rounded-xl border border-slate-700 transition active:scale-95 disabled:opacity-50"
            title="Refresh list"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          </button>

          <button
            onClick={() => {
              setErrorMessage('');
              setIsOrgModalOpen(true);
            }}
            className="flex items-center gap-2 bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white text-xs font-bold py-2.5 px-4 rounded-xl shadow-lg shadow-indigo-600/25 transition active:scale-95 cursor-pointer"
          >
            <PlusCircle className="w-4 h-4" />
            <span>+ Add Organization</span>
          </button>
        </div>
      </div>

      {/* Quick Metrics Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-4 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
            <Building2 className="w-6 h-6" />
          </div>
          <div>
            <div className="text-2xl font-black text-white">{totalOrgs}</div>
            <div className="text-xs text-slate-400 font-medium">Registered Organizations</div>
          </div>
        </div>

        <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-4 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
            <Layers className="w-6 h-6" />
          </div>
          <div>
            <div className="text-2xl font-black text-white">{totalDepts}</div>
            <div className="text-xs text-slate-400 font-medium">Configured Departments</div>
          </div>
        </div>

        <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-4 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
            <GitFork className="w-6 h-6" />
          </div>
          <div>
            <div className="text-2xl font-black text-white">{totalEntryLevel}</div>
            <div className="text-xs text-slate-400 font-medium">Entry-Level Reception Tiers</div>
          </div>
        </div>
      </div>

      {/* Notifications */}
      {successMessage && (
        <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs flex items-center gap-2 animate-fade-in">
          <Sparkles className="w-4 h-4 shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      {errorMessage && (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs flex items-center justify-between animate-fade-in">
          <span>{errorMessage}</span>
          <button onClick={() => setErrorMessage('')} className="text-rose-400 hover:text-rose-300">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Loading state */}
      {loading ? (
        <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-12 text-center text-slate-400 flex flex-col items-center gap-3">
          <RefreshCw className="w-6 h-6 animate-spin text-indigo-400" />
          <span className="text-xs">Loading organizational hierarchy data...</span>
        </div>
      ) : organizations.length === 0 ? (
        /* Empty State */
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-12 text-center text-slate-400 flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
            <Building2 className="w-8 h-8" />
          </div>
          <div className="max-w-md">
            <h3 className="text-base font-bold text-white mb-1">No Organizations Configured</h3>
            <p className="text-xs text-slate-400 mb-4">
              Add your first hospital, government office, or enterprise organization to begin building multi-stage token counters.
            </p>
            <button
              onClick={() => setIsOrgModalOpen(true)}
              className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold py-2.5 px-4 rounded-xl transition"
            >
              <PlusCircle className="w-4 h-4" /> Register Organization
            </button>
          </div>
        </div>
      ) : (
        /* Organizations Card List */
        <div className="space-y-4">
          {organizations.map((org) => {
            const depts = departmentsByOrg[org._id] || [];
            const isExpanded = expandedOrgId === org._id;
            const entryDept = depts.find((d) => d.isEntryLevel);
            const downstreamDepts = depts.filter((d) => !d.isEntryLevel);

            return (
              <div
                key={org._id}
                className="bg-slate-900/90 border border-slate-800 hover:border-slate-700/80 transition duration-200 rounded-2xl overflow-hidden shadow-xl"
              >
                {/* Organization Header Bar */}
                <div className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 rounded-xl bg-slate-800/80 border border-slate-700/60 flex items-center justify-center shrink-0 text-indigo-400">
                      {org.type === 'HOSPITAL' ? (
                        <Hospital className="w-6 h-6 text-cyan-400" />
                      ) : org.type === 'GOVERNMENT' ? (
                        <Landmark className="w-6 h-6 text-amber-400" />
                      ) : (
                        <Building2 className="w-6 h-6 text-purple-400" />
                      )}
                    </div>

                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-base font-bold text-white tracking-wide">{org.name}</h2>
                        {renderTypeBadge(org.type)}
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          {org.status || 'ACTIVE'}
                        </span>
                      </div>

                      {org.address && (
                        <div className="flex items-center gap-1.5 text-xs text-slate-400">
                          <MapPin className="w-3.5 h-3.5 text-slate-500" />
                          <span>{org.address}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    {/* API Key Copy Pill */}
                    {org.apiKey && (
                      <div
                        onClick={() => handleCopyApiKey(org.apiKey, org._id)}
                        className="group flex items-center gap-2 bg-slate-950 border border-slate-800 hover:border-indigo-500/50 px-3 py-1.5 rounded-xl cursor-pointer transition"
                        title="Click to copy API Key"
                      >
                        <Key className="w-3.5 h-3.5 text-indigo-400" />
                        <span className="text-[11px] font-mono text-slate-300">
                          {org.apiKey.slice(0, 6)}••••{org.apiKey.slice(-4)}
                        </span>
                        {copiedKeyId === org._id ? (
                          <span className="flex items-center gap-1 text-[10px] text-emerald-400 font-bold">
                            <Check className="w-3 h-3" /> Copied
                          </span>
                        ) : (
                          <Copy className="w-3 h-3 text-slate-500 group-hover:text-indigo-400 transition" />
                        )}
                      </div>
                    )}

                    {/* Department count indicator */}
                    <span className="px-3 py-1.5 bg-slate-800 text-slate-300 text-xs font-semibold rounded-xl border border-slate-700/60">
                      {depts.length} {depts.length === 1 ? 'Department' : 'Departments'}
                    </span>

                    {/* Manage / Toggle Button */}
                    <button
                      onClick={() => toggleExpandOrg(org._id)}
                      className="flex items-center gap-1.5 bg-indigo-600/10 hover:bg-indigo-600/20 text-indigo-300 text-xs font-semibold px-3.5 py-1.5 rounded-xl border border-indigo-500/20 transition cursor-pointer"
                    >
                      <span>{isExpanded ? 'Hide Hierarchy' : 'View Hierarchy'}</span>
                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Expanded Department Hierarchy Tree */}
                {isExpanded && (
                  <div className="border-t border-slate-800/80 bg-slate-950/60 p-6 space-y-6 animate-fade-in">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div>
                        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                          <GitFork className="w-4 h-4 text-indigo-400" />
                          Department & Counter Hierarchy Tree
                        </h3>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          Tokens are issued at entry-level departments and transferred across downstream counters.
                        </p>
                      </div>

                      <button
                        onClick={() => handleOpenAddDeptModal(org)}
                        className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold py-2 px-3.5 rounded-xl shadow-md shadow-indigo-600/20 transition active:scale-95 cursor-pointer w-fit"
                      >
                        <PlusCircle className="w-3.5 h-3.5" />
                        <span>+ Add Department / Counter</span>
                      </button>
                    </div>

                    {depts.length === 0 ? (
                      <div className="border border-dashed border-slate-800 rounded-xl p-8 text-center text-slate-500 space-y-3">
                        <p className="text-xs">No departments configured yet for {org.name}.</p>
                        <button
                          onClick={() => handleOpenAddDeptModal(org)}
                          className="text-xs text-indigo-400 hover:text-indigo-300 font-semibold underline underline-offset-4"
                        >
                          + Add the first Entry-Level Department
                        </button>
                      </div>
                    ) : (
                      /* Tree Visualization */
                      <div className="space-y-6">
                        {/* ROOT NODE: Organization */}
                        <div className="relative pl-6 before:content-[''] before:absolute before:left-2.5 before:top-8 before:bottom-0 before:w-0.5 before:bg-slate-800">
                          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-800/80 border border-slate-700 text-xs font-bold text-white shadow-md">
                            <Building2 className="w-4 h-4 text-indigo-400" />
                            <span>{org.name}</span>
                            <span className="text-[10px] text-slate-400 font-normal">
                              (Root Organization)
                            </span>
                          </div>

                          {/* ENTRY LEVEL NODE(S) */}
                          <div className="mt-4 space-y-3">
                            <div className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                              <span>⭐ Stage 1: Entry-Level Station (Token Dispenser Target)</span>
                            </div>

                            {entryDept ? (
                              <div className="bg-gradient-to-r from-emerald-950/40 to-slate-900 border border-emerald-500/40 rounded-xl p-4 shadow-lg relative">
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                  <div className="space-y-1">
                                    <div className="flex items-center gap-2">
                                      <span className="px-2 py-0.5 rounded-md font-mono text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                                        [{entryDept.prefix}]
                                      </span>
                                      <h4 className="text-sm font-bold text-white">{entryDept.name}</h4>
                                      <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full font-semibold">
                                        Entry Level
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-4 text-xs text-slate-400">
                                      <span className="flex items-center gap-1">
                                        <Clock className="w-3.5 h-3.5 text-slate-500" />
                                        Avg Service: {entryDept.avgServiceTimeMins || 5} mins
                                      </span>
                                    </div>
                                  </div>

                                  {/* Sub-counters chips */}
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    {entryDept.subCounters && entryDept.subCounters.length > 0 ? (
                                      entryDept.subCounters.map((counter, idx) => (
                                        <span
                                          key={idx}
                                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-950 border border-slate-800 text-slate-300"
                                        >
                                          <Tag className="w-3 h-3 text-emerald-400" />
                                          {counter}
                                        </span>
                                      ))
                                    ) : (
                                      <span className="text-xs text-slate-500 italic">No sub-counters</span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            ) : (
                              <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-400 text-xs flex items-center justify-between">
                                <span>No entry-level department designated yet!</span>
                                <button
                                  onClick={() => handleOpenAddDeptModal(org)}
                                  className="text-xs font-bold underline"
                                >
                                  Configure One
                                </button>
                              </div>
                            )}
                          </div>

                          {/* DOWNSTREAM / TRANSFER DEPARTMENTS */}
                          {downstreamDepts.length > 0 && (
                            <div className="mt-6 space-y-3">
                              <div className="flex items-center gap-2 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                                <ArrowRight className="w-3.5 h-3.5 text-indigo-400" />
                                <span>Stage 2+: Downstream Specialized Counters (Transfer Flow)</span>
                              </div>

                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                {downstreamDepts.map((dept) => (
                                  <div
                                    key={dept._id}
                                    className="bg-slate-900 border border-slate-800 hover:border-slate-700/80 rounded-xl p-4 space-y-3 transition"
                                  >
                                    <div className="flex items-center justify-between gap-2">
                                      <div className="flex items-center gap-2">
                                        <span className="px-2 py-0.5 rounded-md font-mono text-xs font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                                          [{dept.prefix}]
                                        </span>
                                        <h5 className="text-xs font-bold text-white">{dept.name}</h5>
                                      </div>

                                      <span className="flex items-center gap-1 text-[11px] text-slate-400">
                                        <Clock className="w-3 h-3 text-slate-500" />
                                        {dept.avgServiceTimeMins || 5}m
                                      </span>
                                    </div>

                                    {/* Sub-counters */}
                                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                                      {dept.subCounters && dept.subCounters.length > 0 ? (
                                        dept.subCounters.map((counter, idx) => (
                                          <span
                                            key={idx}
                                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-slate-950 border border-slate-800 text-slate-300"
                                          >
                                            <Tag className="w-2.5 h-2.5 text-indigo-400" />
                                            {counter}
                                          </span>
                                        ))
                                      ) : (
                                        <span className="text-[11px] text-slate-500 italic">Single Counter</span>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ========================================================== */}
      {/* MODAL: + Add Organization */}
      {/* ========================================================== */}
      {isOrgModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Building2 className="w-5 h-5 text-indigo-400" />
                Add New Public / Private Organization
              </h3>
              <button
                onClick={() => setIsOrgModalOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateOrgSubmit} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-slate-300 mb-1.5 block">
                  Organization Name *
                </label>
                <input
                  type="text"
                  placeholder="e.g. Patan Hospital or District Administration Office"
                  value={orgForm.name}
                  onChange={(e) => setOrgForm({ ...orgForm, name: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl px-4 py-2.5 text-xs focus:outline-none focus:border-indigo-500"
                  required
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 mb-1.5 block">
                  Institution Type *
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { value: 'HOSPITAL', label: 'Hospital', icon: Hospital },
                    { value: 'GOVERNMENT', label: 'Government', icon: Landmark },
                    { value: 'PRIVATE', label: 'Private', icon: Briefcase }
                  ].map((t) => {
                    const Icon = t.icon;
                    const isSelected = orgForm.type === t.value;
                    return (
                      <button
                        type="button"
                        key={t.value}
                        onClick={() => setOrgForm({ ...orgForm, type: t.value })}
                        className={`flex items-center justify-center gap-2 p-2.5 rounded-xl border text-xs font-bold transition cursor-pointer ${
                          isSelected
                            ? 'bg-indigo-600/20 border-indigo-500 text-indigo-300 shadow-md'
                            : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                        }`}
                      >
                        <Icon className="w-3.5 h-3.5" />
                        <span>{t.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 mb-1.5 block">
                  Physical Location / Address
                </label>
                <input
                  type="text"
                  placeholder="e.g. Lagankhel, Lalitpur, Nepal"
                  value={orgForm.address}
                  onChange={(e) => setOrgForm({ ...orgForm, address: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl px-4 py-2.5 text-xs focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsOrgModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={formSubmitting}
                  className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-bold py-2.5 px-5 rounded-xl transition shadow-lg shadow-indigo-600/25"
                >
                  {formSubmitting ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <PlusCircle className="w-4 h-4" />
                  )}
                  <span>Create Organization</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================== */}
      {/* MODAL: + Add Department / Counter */}
      {/* ========================================================== */}
      {isDeptModalOpen && targetOrgForDept && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <Layers className="w-5 h-5 text-cyan-400" />
                  Add Department / Counter
                </h3>
                <p className="text-[11px] text-slate-400">
                  Adding to <span className="text-white font-bold">{targetOrgForDept.name}</span>
                </p>
              </div>
              <button
                onClick={() => setIsDeptModalOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateDeptSubmit} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-slate-300 mb-1.5 block">
                  Department Name *
                </label>
                <input
                  type="text"
                  placeholder="e.g. Emergency Triage, Cardiology OPD, Citizenship Desk"
                  value={deptForm.name}
                  onChange={(e) => setDeptForm({ ...deptForm, name: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl px-4 py-2.5 text-xs focus:outline-none focus:border-indigo-500"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-300 mb-1.5 block">
                    Ticket Prefix * (2-5 letters)
                  </label>
                  <input
                    type="text"
                    maxLength={5}
                    placeholder="e.g. TRG, DOC, CIT"
                    value={deptForm.prefix}
                    onChange={(e) =>
                      setDeptForm({ ...deptForm, prefix: e.target.value.toUpperCase() })
                    }
                    className="w-full bg-slate-950 border border-slate-800 text-white font-mono rounded-xl px-4 py-2.5 text-xs focus:outline-none focus:border-indigo-500 uppercase"
                    required
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-300 mb-1.5 block">
                    Avg Service Time (mins)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={120}
                    value={deptForm.avgServiceTimeMins}
                    onChange={(e) =>
                      setDeptForm({ ...deptForm, avgServiceTimeMins: e.target.value })
                    }
                    className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl px-4 py-2.5 text-xs focus:outline-none focus:border-indigo-500"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 mb-1.5 block">
                  Sub-Counters (Comma-separated)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Desk 1, Desk 2, Room 105"
                  value={deptForm.subCountersInput}
                  onChange={(e) =>
                    setDeptForm({ ...deptForm, subCountersInput: e.target.value })
                  }
                  className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl px-4 py-2.5 text-xs focus:outline-none focus:border-indigo-500"
                />
                {deptForm.subCountersInput && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {deptForm.subCountersInput
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean)
                      .map((c, i) => (
                        <span
                          key={i}
                          className="px-2 py-0.5 rounded-md text-[10px] bg-slate-800 border border-slate-700 text-slate-300 flex items-center gap-1"
                        >
                          <Tag className="w-2.5 h-2.5 text-indigo-400" />
                          {c}
                        </span>
                      ))}
                  </div>
                )}
              </div>

              {/* Is Entry Level Checkbox */}
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 flex items-start gap-3">
                <input
                  type="checkbox"
                  id="isEntryLevel"
                  checked={deptForm.isEntryLevel}
                  onChange={(e) =>
                    setDeptForm({ ...deptForm, isEntryLevel: e.target.checked })
                  }
                  className="mt-1 w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-slate-700 bg-slate-900 cursor-pointer"
                />
                <label htmlFor="isEntryLevel" className="text-xs cursor-pointer">
                  <span className="font-bold text-white block">
                    Is Entry-Level Station (Initial Check-In)
                  </span>
                  <span className="text-[11px] text-slate-400">
                    New tokens dispensed at kiosk/reception will be routed to this department first.
                  </span>
                </label>
              </div>

              <div className="pt-2 flex items-center justify-end gap-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsDeptModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={formSubmitting}
                  className="flex items-center gap-2 bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 disabled:opacity-50 text-white text-xs font-bold py-2.5 px-5 rounded-xl transition shadow-lg shadow-indigo-600/25"
                >
                  {formSubmitting ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <PlusCircle className="w-4 h-4" />
                  )}
                  <span>Add Department</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}