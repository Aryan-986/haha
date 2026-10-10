import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Users, PlayCircle, CheckCircle, PauseCircle, Clock, 
  Coffee, RefreshCw, AlertTriangle, Monitor, ArrowRight
} from 'lucide-react';
import apiClient from '../services/apiClient';
import { getSocket, onSocketReconnect } from '../services/socket';

const PRIORITY_BADGE = {
  NORMAL: 'bg-neutral-100 text-neutral-700 border-neutral-200',
  URGENT: 'bg-amber-50 text-amber-800 border-amber-200',
  EMERGENCY: 'bg-rose-50 text-rose-800 border-rose-200 animate-pulse',
};

function formatDuration(startDate) {
  if (!startDate) return '—';
  const secs = Math.floor((Date.now() - new Date(startDate)) / 1000);
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
}

function timeAgo(date) {
  if (!date) return '—';
  const secs = Math.floor((Date.now() - new Date(date)) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
}

export default function SupervisorDashboard() {
  const [orgs, setOrgs] = useState([]);
  const [orgId, setOrgId] = useState('');
  const [depts, setDepts] = useState([]);
  const [deptId, setDeptId] = useState('');
  const [liveData, setLiveData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState('queue');

  const socketRef = useRef(null);
  const prevScopeRef = useRef({ orgId: '', deptId: '' });

  // ── Fetch Live Data ────────────────────────────────────────────
  const fetchLive = useCallback(async () => {
    if (!deptId) return;
    try {
      const r = await apiClient.get(`/departments/${deptId}/live?orgId=${orgId}`);
      setLiveData(r.data);
    } catch (err) {
      console.error('Error fetching live data:', err);
    }
  }, [deptId, orgId]);

  // ── Shared Socket.IO ───────────────────────────────────────────
  useEffect(() => {
    const socket = getSocket();
    socketRef.current = socket;

    const onUpdate = () => fetchLive();

    socket.on('queue.updated', onUpdate);
    socket.on('ticket.called', onUpdate);
    socket.on('ticket.started', onUpdate);
    socket.on('ticket.completed', onUpdate);
    socket.on('ticket.transferred', onUpdate);
    socket.on('counter.updated', onUpdate);
    socket.on('worker.updated', onUpdate);

    const unregReconnect = onSocketReconnect(() => {
      fetchLive();
    });

    return () => {
      unregReconnect();
      socket.off('queue.updated', onUpdate);
      socket.off('ticket.called', onUpdate);
      socket.off('ticket.started', onUpdate);
      socket.off('ticket.completed', onUpdate);
      socket.off('ticket.transferred', onUpdate);
      socket.off('counter.updated', onUpdate);
      socket.off('worker.updated', onUpdate);
    };
  }, [deptId, orgId, fetchLive]);

  useEffect(() => {
    const socket = getSocket();
    const prev = prevScopeRef.current;
    if (prev.orgId !== orgId || prev.deptId !== deptId) {
      socket.emit('switch_scope', { oldOrgId: prev.orgId, oldDeptId: prev.deptId, newOrgId: orgId, newDeptId: deptId });
      prevScopeRef.current = { orgId, deptId };
    }
  }, [orgId, deptId]);

  useEffect(() => {
    apiClient.get('/orgs').then(r => {
      if (r.data?.length > 0) { setOrgs(r.data); setOrgId(r.data[0]._id); }
    }).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!orgId) return;
    setDeptId(''); setLiveData(null);
    apiClient.get(`/orgs/${orgId}/departments`).then(r => {
      const d = r.data || []; setDepts(d);
      if (d.length > 0) setDeptId(d[0]._id);
    });
  }, [orgId]);

  useEffect(() => {
    if (!deptId) return;
    fetchLive();
    const iv = setInterval(fetchLive, 4000);
    return () => clearInterval(iv);
  }, [fetchLive, deptId]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchLive();
    setRefreshing(false);
  };

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto p-12 text-center text-neutral-500 font-sans">
        <RefreshCw className="w-8 h-8 mx-auto animate-spin mb-3 text-neutral-400" />
        <p className="text-sm font-medium">Loading supervisor portal...</p>
      </div>
    );
  }

  const stats = liveData?.stats;
  const dept = liveData?.department;
  const tickets = liveData?.tickets || {};
  const counters = liveData?.counters || [];
  const alerts = liveData?.alerts || [];

  // Metrics calculation
  const waitingTickets = tickets.waiting || [];
  const servingTickets = [...(tickets.called || []), ...(tickets.serving || [])];
  const waitingCount = stats?.waiting ?? waitingTickets.length;
  const servingCount = stats?.serving ?? servingTickets.length;
  const availableCountersCount = counters.filter(c => c.status === 'AVAILABLE').length;
  const busyCountersCount = counters.filter(c => c.status === 'BUSY').length;
  const workersOnBreakCount = counters.filter(c => c.status === 'PAUSED' || c.assignedWorkerId?.status === 'ON_BREAK').length;

  // Longest-waiting ticket
  const longestWaiting = waitingTickets.length > 0 ? waitingTickets[0] : null;

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-6 bg-white min-h-screen text-neutral-900 font-sans">
      
      {/* ── Top Header & Department Selector ── */}
      <section className="border border-neutral-200 rounded-xl p-5 bg-white shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-neutral-100">
          <div>
            <h1 className="text-xl font-bold text-neutral-900 flex items-center gap-2">
              <span>Supervisor Dashboard</span>
              {dept && <span className="text-sm font-normal text-neutral-500">· {dept.name}</span>}
            </h1>
            <p className="text-xs text-neutral-500 mt-0.5">Live queue monitoring and operational metrics</p>
          </div>

          <button 
            onClick={handleRefresh}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-neutral-50 border border-neutral-200 hover:bg-neutral-100 text-neutral-700 text-xs font-semibold rounded-lg transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            <span>{refreshing ? 'Refreshing...' : 'Refresh'}</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-neutral-600 mb-1">Office / Organization</label>
            <select 
              value={orgId} 
              onChange={e => setOrgId(e.target.value)}
              className="w-full bg-white border border-neutral-200 text-xs rounded-lg p-2 text-neutral-900 focus:outline-none focus:ring-1 focus:ring-emerald-700"
            >
              {orgs.map(o => <option key={o._id} value={o._id}>{o.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-neutral-600 mb-1">Department</label>
            <select 
              value={deptId} 
              onChange={e => setDeptId(e.target.value)}
              className="w-full bg-white border border-neutral-200 text-xs rounded-lg p-2 text-neutral-900 focus:outline-none focus:ring-1 focus:ring-emerald-700"
            >
              {depts.map(d => (
                <option key={d._id} value={d._id}>
                  {d.name} ({d.prefix}){d.roomNumber ? ` · Room ${d.roomNumber}` : ''}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {/* ── Alerts Banner (if any) ── */}
      {alerts.length > 0 && (
        <div className="space-y-2">
          {alerts.map((a, i) => (
            <div key={i} className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 text-amber-900 rounded-lg text-xs font-medium">
              <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
              <span>{a.message}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Key Operational Metrics (Summary Cards) ── */}
      <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {/* 1. Waiting Tickets */}
        <div className="bg-neutral-50 border border-neutral-200 rounded-xl p-3.5 text-center">
          <div className="text-2xl font-black text-neutral-900 font-mono">{waitingCount}</div>
          <div className="text-xs font-medium text-neutral-500 mt-1 flex items-center justify-center gap-1">
            <Users className="w-3.5 h-3.5 text-neutral-400" />
            <span>Waiting</span>
          </div>
        </div>

        {/* 2. Currently Serving */}
        <div className="bg-neutral-50 border border-neutral-200 rounded-xl p-3.5 text-center">
          <div className="text-2xl font-black text-emerald-700 font-mono">{servingCount}</div>
          <div className="text-xs font-medium text-neutral-500 mt-1 flex items-center justify-center gap-1">
            <PlayCircle className="w-3.5 h-3.5 text-emerald-600" />
            <span>Serving</span>
          </div>
        </div>

        {/* 3. Available Counters */}
        <div className="bg-neutral-50 border border-neutral-200 rounded-xl p-3.5 text-center">
          <div className="text-2xl font-black text-emerald-700 font-mono">{availableCountersCount}</div>
          <div className="text-xs font-medium text-neutral-500 mt-1 flex items-center justify-center gap-1">
            <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
            <span>Available</span>
          </div>
        </div>

        {/* 4. Busy Counters */}
        <div className="bg-neutral-50 border border-neutral-200 rounded-xl p-3.5 text-center">
          <div className="text-2xl font-black text-neutral-900 font-mono">{busyCountersCount}</div>
          <div className="text-xs font-medium text-neutral-500 mt-1 flex items-center justify-center gap-1">
            <Monitor className="w-3.5 h-3.5 text-neutral-400" />
            <span>Busy</span>
          </div>
        </div>

        {/* 5. Workers on Break */}
        <div className="bg-neutral-50 border border-neutral-200 rounded-xl p-3.5 text-center">
          <div className="text-2xl font-black text-amber-700 font-mono">{workersOnBreakCount}</div>
          <div className="text-xs font-medium text-neutral-500 mt-1 flex items-center justify-center gap-1">
            <Coffee className="w-3.5 h-3.5 text-amber-600" />
            <span>On Break</span>
          </div>
        </div>

        {/* 6. Longest Wait */}
        <div className="bg-neutral-50 border border-neutral-200 rounded-xl p-3.5 text-center">
          <div className="text-base font-bold text-neutral-900 truncate">
            {longestWaiting ? timeAgo(longestWaiting.createdAt) : '—'}
          </div>
          <div className="text-xs font-medium text-neutral-500 mt-1 flex items-center justify-center gap-1">
            <Clock className="w-3.5 h-3.5 text-neutral-400" />
            <span>Longest Wait</span>
          </div>
        </div>
      </section>

      {/* ── Navigation Tabs ── */}
      <div className="flex border-b border-neutral-200 gap-4 text-xs font-semibold">
        <button
          onClick={() => setActiveTab('queue')}
          className={`pb-2.5 transition border-b-2 ${
            activeTab === 'queue'
              ? 'border-emerald-700 text-emerald-800'
              : 'border-transparent text-neutral-500 hover:text-neutral-900'
          }`}
        >
          Department Queue ({waitingCount})
        </button>
        <button
          onClick={() => setActiveTab('counters')}
          className={`pb-2.5 transition border-b-2 ${
            activeTab === 'counters'
              ? 'border-emerald-700 text-emerald-800'
              : 'border-transparent text-neutral-500 hover:text-neutral-900'
          }`}
        >
          Counters ({counters.length})
        </button>
        <button
          onClick={() => setActiveTab('activity')}
          className={`pb-2.5 transition border-b-2 ${
            activeTab === 'activity'
              ? 'border-emerald-700 text-emerald-800'
              : 'border-transparent text-neutral-500 hover:text-neutral-900'
          }`}
        >
          Recent Activity
        </button>
      </div>

      {/* ── TAB 1: Department Queue ── */}
      {activeTab === 'queue' && (
        <section className="border border-neutral-200 rounded-xl overflow-hidden bg-white shadow-sm">
          <div className="p-4 bg-neutral-50 border-b border-neutral-200 flex items-center justify-between">
            <h2 className="text-xs font-bold text-neutral-700 uppercase tracking-wider">Live Department Queue</h2>
            <span className="text-xs text-neutral-500">{waitingCount} Waiting Tickets</span>
          </div>

          {waitingTickets.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-neutral-200 bg-neutral-50/50 text-neutral-500 font-semibold text-left">
                    <th className="py-2.5 px-4 w-12">#</th>
                    <th className="py-2.5 px-4">Ticket Number</th>
                    <th className="py-2.5 px-4">Priority</th>
                    <th className="py-2.5 px-4">Status</th>
                    <th className="py-2.5 px-4 text-right">Waiting Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {waitingTickets.map((t, index) => (
                    <tr key={t._id} className="hover:bg-neutral-50 transition">
                      <td className="py-2.5 px-4 font-mono text-neutral-400">{index + 1}</td>
                      <td className="py-2.5 px-4 font-mono font-bold text-neutral-900 text-sm">{t.ticketNumber}</td>
                      <td className="py-2.5 px-4">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold border ${PRIORITY_BADGE[t.priority]}`}>
                          {t.priority}
                        </span>
                      </td>
                      <td className="py-2.5 px-4">
                        <span className="inline-flex px-2 py-0.5 rounded text-[11px] font-medium bg-neutral-100 text-neutral-700 border border-neutral-200">
                          {t.status}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-right text-neutral-500 font-mono">
                        {timeAgo(t.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-12 text-center text-neutral-500 space-y-1">
              <CheckCircle className="w-8 h-8 mx-auto text-emerald-600 mb-2" />
              <p className="text-sm font-semibold text-neutral-800">No tickets currently waiting in queue</p>
              <p className="text-xs text-neutral-500">All citizens in this department have been served or called.</p>
            </div>
          )}
        </section>
      )}

      {/* ── TAB 2: Counters ── */}
      {activeTab === 'counters' && (
        <section className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {counters.length > 0 ? (
            counters.map(c => (
              <div key={c._id} className="border border-neutral-200 rounded-xl p-4 bg-white shadow-sm space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-bold text-sm text-neutral-900">{c.name || `Counter ${c.counterNumber}`}</h3>
                    <p className="text-xs text-neutral-500">
                      Staff: {c.assignedWorkerId?.name || 'Unassigned'}
                      {c.assignedWorkerId?.status === 'ON_BREAK' && (
                        <span className="text-amber-700 font-medium ml-1">· On Break</span>
                      )}
                    </p>
                  </div>
                  <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border ${
                    c.status === 'AVAILABLE' 
                      ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                      : c.status === 'BUSY'
                      ? 'bg-blue-50 text-blue-800 border-blue-200'
                      : 'bg-neutral-100 text-neutral-700 border-neutral-200'
                  }`}>
                    {c.status}
                  </span>
                </div>

                {c.currentTicketId ? (
                  <div className="p-3 bg-neutral-50 border border-neutral-200 rounded-lg flex items-center justify-between">
                    <div>
                      <span className="text-[10px] text-neutral-500 uppercase font-semibold block">Serving Ticket</span>
                      <span className="font-mono font-bold text-base text-neutral-900">{c.currentTicketId.ticketNumber}</span>
                    </div>
                    {c.currentTicketId.serviceStartedAt && (
                      <span className="text-xs text-neutral-500 font-mono">
                        {formatDuration(c.currentTicketId.serviceStartedAt)}
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="py-3 text-center text-xs text-neutral-400 bg-neutral-50 rounded-lg border border-neutral-100">
                    Counter is idle
                  </div>
                )}
              </div>
            ))
          ) : (
            <div className="col-span-2 p-8 border border-neutral-200 rounded-xl text-center text-xs text-neutral-500 bg-neutral-50">
              No counters configured for this department.
            </div>
          )}
        </section>
      )}

      {/* ── TAB 3: Recent Activity ── */}
      {activeTab === 'activity' && (
        <section className="border border-neutral-200 rounded-xl p-5 bg-white shadow-sm space-y-4">
          <h2 className="text-xs font-bold text-neutral-700 uppercase tracking-wider">Completed & Transferred Tickets</h2>
          
          {(tickets.completed || []).length > 0 || (tickets.transferred || []).length > 0 ? (
            <div className="space-y-2">
              {(tickets.completed || []).slice(0, 8).map(t => (
                <div key={t._id} className="p-3 bg-neutral-50 border border-neutral-100 rounded-lg flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-emerald-600" />
                    <span className="font-mono font-bold text-neutral-900">{t.ticketNumber}</span>
                    <span className="text-neutral-500">Service completed</span>
                  </div>
                  <span className="text-neutral-400 font-mono">{timeAgo(t.completedAt || t.updatedAt)}</span>
                </div>
              ))}
              {(tickets.transferred || []).map(t => (
                <div key={t._id} className="p-3 bg-neutral-50 border border-neutral-100 rounded-lg flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <ArrowRight className="w-4 h-4 text-neutral-500" />
                    <span className="font-mono font-bold text-neutral-900">{t.ticketNumber}</span>
                    <span className="text-neutral-500">Transferred to another department</span>
                  </div>
                  <span className="text-neutral-400 font-mono">{timeAgo(t.updatedAt)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-8 text-center text-xs text-neutral-500">
              No recent activity recorded for this department today.
            </div>
          )}
        </section>
      )}

    </div>
  );
}
