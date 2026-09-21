import React, { useState, useEffect } from 'react';
import axios from 'axios';
import KioskHardwareSimulator from '../components/KioskHardwareSimulator';

const API_BASE = 'http://localhost:5000/api/v1';

const WorkerDashboard = () => {
  // Multi-Tenant Context State
  const [organizations, setOrganizations] = useState([]);
  const [selectedOrgId, setSelectedOrgId] = useState('');
  const [departments, setDepartments] = useState([]);
  const [currentDeptId, setCurrentDeptId] = useState('');

  // Queue & Ticket State
  const [currentTicket, setCurrentTicket] = useState(null);
  const [targetDeptId, setTargetDeptId] = useState('');
  const [loading, setLoading] = useState(true);
  const [transferring, setTransferring] = useState(false);
  const [error, setError] = useState(null);
  const [statusMessage, setStatusMessage] = useState('');

  // Fetch initial Organizations list
  useEffect(() => {
    const fetchOrganizations = async () => {
      try {
        const res = await axios.get(`${API_BASE}/orgs`);
        if (res.data && res.data.length > 0) {
          setOrganizations(res.data);
          setSelectedOrgId(res.data[0]._id);
        }
      } catch (err) {
        console.error('Failed to load organizations:', err);
        setError('Failed to connect to Multi-Tenant service.');
      } finally {
        setLoading(false);
      }
    };
    fetchOrganizations();
  }, []);

  // Fetch Departments when selected organization changes
  useEffect(() => {
    if (!selectedOrgId) return;

    const fetchDepartments = async () => {
      try {
        const res = await axios.get(`${API_BASE}/orgs/${selectedOrgId}/departments`);
        setDepartments(res.data || []);
        if (res.data && res.data.length > 0) {
          setCurrentDeptId(res.data[0]._id);
        }
      } catch (err) {
        console.error('Failed to fetch departments:', err);
      }
    };

    fetchDepartments();
  }, [selectedOrgId]);

  // Call Next Ticket Action
  const handleCallNext = async () => {
    if (!currentDeptId) return;
    setStatusMessage('');
    try {
      const res = await axios.post(`${API_BASE}/worker/department/${currentDeptId}/call-next`);
      if (res.data?.ticket) {
        setCurrentTicket(res.data.ticket);
      } else {
        setStatusMessage('No waiting tickets in this queue.');
      }
    } catch (err) {
      console.error('Call next error:', err);
      setStatusMessage('Error calling next ticket.');
    }
  };

  // Transfer Token Action
  const handleTransferToken = async () => {
    if (!currentTicket?._id || !targetDeptId) return;
    setTransferring(true);
    setStatusMessage('');

    try {
      await axios.post(`${API_BASE}/tokens/transfer`, {
        ticketId: currentTicket._id,
        targetDeptId: targetDeptId,
        workerId: 'WORKER_DESK_1'
      });

      const targetDeptName = departments.find((d) => d._id === targetDeptId)?.name || 'Target Department';
      setStatusMessage(`Ticket ${currentTicket.ticketNumber || currentTicket} transferred to ${targetDeptName}!`);
      setCurrentTicket(null);
      setTargetDeptId('');
    } catch (err) {
      console.error('Transfer token error:', err);
      setStatusMessage('Failed to transfer ticket. Please try again.');
    } finally {
      setTransferring(false);
    }
  };

  if (loading) {
    return <div className="p-8 text-center text-slate-400">Loading Multi-Tenant Staff Portal...</div>;
  }

  const activeDepartment = departments.find((d) => d._id === currentDeptId);
  const availableTransferDestinations = departments.filter((d) => d._id !== currentDeptId);

  return (
    <div className="max-w-xl mx-auto p-6 space-y-6 bg-slate-900 text-slate-100 min-h-screen">
      {/* Context Selector Bar */}
      <header className="border-b border-slate-800 pb-4 space-y-3">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Counter Staff Portal</h1>
          <span className="text-xs bg-indigo-500/20 text-indigo-300 px-2.5 py-1 rounded-full border border-indigo-500/30 font-medium">
            Multi-Tenant
          </span>
        </div>

        {/* Organization & Counter Dropdowns */}
        <div className="grid grid-cols-2 gap-3 pt-2">
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1">Organization</label>
            <select
              value={selectedOrgId}
              onChange={(e) => setSelectedOrgId(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 text-xs rounded-lg p-2 text-slate-200 focus:outline-none focus:border-indigo-500"
            >
              {organizations.map((org) => (
                <option key={org._id} value={org._id}>
                  {org.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1">Active Station/Room</label>
            <select
              value={currentDeptId}
              onChange={(e) => setCurrentDeptId(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 text-xs rounded-lg p-2 text-slate-200 focus:outline-none focus:border-indigo-500"
            >
              {departments.map((dept) => (
                <option key={dept._id} value={dept._id}>
                  {dept.name} ({dept.prefix}) {dept.isEntryLevel ? '[Entry]' : ''}
                </option>
              ))}
            </select>
          </div>
        </div>
      </header>

      {error && (
        <div className="bg-red-500/10 border border-red-500 text-red-400 p-3 rounded-md text-sm">
          {error}
        </div>
      )}

      {statusMessage && (
        <div className="bg-indigo-500/10 border border-indigo-500 text-indigo-300 p-3 rounded-md text-sm text-center font-medium">
          {statusMessage}
        </div>
      )}

      {/* Hardware Simulator Sync */}
      {selectedOrgId && (
        <KioskHardwareSimulator orgId={selectedOrgId} deptId={currentDeptId} />
      )}

      {/* Active Serving Card */}
      <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 space-y-4">
        <div className="text-center space-y-1">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Now Serving at {activeDepartment?.name || 'Station'}
          </span>
          <div className="text-5xl font-extrabold text-indigo-400 tracking-tight my-2">
            {currentTicket?.ticketNumber || currentTicket || '---'}
          </div>
        </div>

        <button
          onClick={handleCallNext}
          className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-lg transition duration-200 shadow-lg shadow-emerald-900/20"
        >
          ✓ Call Next Ticket
        </button>

        {/* Multi-Stage Token Transfer Control */}
        {currentTicket && (
          <div className="pt-4 border-t border-slate-700/80 space-y-3">
            <span className="text-xs font-semibold text-amber-400 uppercase tracking-wider block">
              Transfer Patient/Citizen Downstream
            </span>

            <div className="flex items-center space-x-2">
              <select
                value={targetDeptId}
                onChange={(e) => setTargetDeptId(e.target.value)}
                className="flex-1 bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-xs text-slate-200 focus:outline-none focus:border-amber-500"
              >
                <option value="">Select Target Counter/Room...</option>
                {availableTransferDestinations.map((dept) => (
                  <option key={dept._id} value={dept._id}>
                    {dept.name} ({dept.prefix})
                  </option>
                ))}
              </select>

              <button
                onClick={handleTransferToken}
                disabled={!targetDeptId || transferring}
                className="py-2.5 px-4 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition duration-200 whitespace-nowrap"
              >
                {transferring ? 'Transferring...' : '⇄ Transfer'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default WorkerDashboard;