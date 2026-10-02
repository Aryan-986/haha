import React, { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';

const API = 'http://localhost:5000/api/v1';
const SOCKET_URL = 'http://localhost:5000';

const STATUS_COLORS = {
  WAITING: 'text-amber-400 border-amber-700/40 bg-amber-950/30',
  CALLED: 'text-blue-400 border-blue-700/40 bg-blue-950/30',
  SERVING: 'text-emerald-400 border-emerald-700/40 bg-emerald-950/30',
  COMPLETED: 'text-slate-400 border-slate-700 bg-slate-800/30',
  SNOOZED: 'text-purple-400 border-purple-700/40 bg-purple-950/30',
  SKIPPED: 'text-orange-400 border-orange-700/40 bg-orange-950/30',
  NO_SHOW: 'text-red-400 border-red-700/40 bg-red-950/30',
  TRANSFERRED: 'text-cyan-400 border-cyan-700/40 bg-cyan-950/30',
};

const COUNTER_STATUS_COLORS = {
  AVAILABLE: 'bg-emerald-900/30 text-emerald-400 border-emerald-700/40',
  BUSY: 'bg-blue-900/30 text-blue-400 border-blue-700/40',
  PAUSED: 'bg-amber-900/30 text-amber-400 border-amber-700/40',
  OFFLINE: 'bg-slate-800 text-slate-500 border-slate-700',
};

const ALERT_COLORS = {
  HIGH_QUEUE: 'bg-red-950/50 border-red-700/40 text-red-300',
  LONG_WAIT: 'bg-amber-950/50 border-amber-700/40 text-amber-300',
  COUNTERS_OFFLINE: 'bg-slate-800 border-slate-600 text-slate-300',
  COUNTERS_ON_BREAK: 'bg-amber-950/30 border-amber-700/30 text-amber-400',
  LONG_SERVICE: 'bg-orange-950/50 border-orange-700/40 text-orange-300',
};

const PRIORITY_BADGE = {
  NORMAL: 'bg-slate-700 text-slate-300',
  URGENT: 'bg-amber-900/60 text-amber-300',
  EMERGENCY: 'bg-red-900/60 text-red-300 animate-pulse',
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
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  return `${Math.floor(secs / 3600)}h`;
}

export default function SupervisorDashboard() {
  const [orgs, setOrgs] = useState([]);
  const [orgId, setOrgId] = useState('');
  const [depts, setDepts] = useState([]);
  const [deptId, setDeptId] = useState('');
  const [liveData, setLiveData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');

  const socketRef = useRef(null);
  const prevScopeRef = useRef({ orgId: '', deptId: '' });

  // ── Socket.IO ──────────────────────────────────────────────────
  useEffect(() => {
    const socket = io(SOCKET_URL, { transports: ['websocket', 'polling'] });
    socketRef.current = socket;
    socket.on('queue.updated', () => fetchLive());
    socket.on('ticket.called', () => fetchLive());
    socket.on('ticket.started', () => fetchLive());
    socket.on('ticket.completed', () => fetchLive());
    socket.on('ticket.transferred', () => fetchLive());
    socket.on('counter.updated', () => fetchLive());
    socket.on('worker.updated', () => fetchLive());
    return () => socket.disconnect();
  }, [deptId, orgId]);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;
    const prev = prevScopeRef.current;
    socket.emit('switch_scope', { oldOrgId: prev.orgId, oldDeptId: prev.deptId, newOrgId: orgId, newDeptId: deptId });
    prevScopeRef.current = { orgId, deptId };
  }, [orgId, deptId]);

  // ── Fetch Live Data ────────────────────────────────────────────
  const fetchLive = useCallback(async () => {
    if (!deptId) return;
    try {
      const r = await axios.get(`${API}/departments/${deptId}/live?orgId=${orgId}`);
      setLiveData(r.data);
    } catch (err) {
      console.error('Error fetching live data:', err);
    }
  }, [deptId, orgId]);

  useEffect(() => {
    axios.get(`${API}/orgs`).then(r => {
      if (r.data?.length > 0) { setOrgs(r.data); setOrgId(r.data[0]._id); }
    }).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!orgId) return;
    setDeptId(''); setLiveData(null);
    axios.get(`${API}/orgs/${orgId}/departments`).then(r => {
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

  if (loading) return <div className="p-10 text-center text-slate-400">Loading Supervisor Portal...</div>;

  const stats = liveData?.stats;
  const dept = liveData?.department;
  const tickets = liveData?.tickets || {};
  const counters = liveData?.counters || [];
  const alerts = liveData?.alerts || [];

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'queue', label: `Queue (${stats?.waiting || 0})` },
    { id: 'counters', label: `Counters (${counters.length})` },
    { id: 'activity', label: 'Activity' },
  ];

  return (
    <div className="max-w-5xl mx-auto p-4 space-y-4 text-slate-100 min-h-screen bg-slate-950">
      {/* ── Header ── */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold tracking-tight">
            🎛 Supervisor Portal
            {dept && <span className="ml-2 text-sm font-normal text-slate-400">· {dept.name}</span>}
          </h1>
          <button onClick={handleRefresh}
            className={`text-xs px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-slate-300 transition ${refreshing ? 'animate-pulse' : ''}`}>
            ⟳ {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">Organization</label>
            <select value={orgId} onChange={e => setOrgId(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 text-xs rounded-lg p-2 text-slate-200 focus:outline-none focus:border-indigo-500">
              {orgs.map(o => <option key={o._id} value={o._id}>{o.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">Department</label>
            <select value={deptId} onChange={e => setDeptId(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 text-xs rounded-lg p-2 text-slate-200 focus:outline-none focus:border-indigo-500">
              {depts.map(d => <option key={d._id} value={d._id}>{d.name} ({d.prefix})</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* ── Alerts ── */}
      {alerts.length > 0 && (
        <div className="space-y-1.5">
          {alerts.map((a, i) => (
            <div key={i} className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-medium ${ALERT_COLORS[a.type] || 'bg-slate-800 border-slate-700 text-slate-300'}`}>
              <span>{a.type === 'HIGH_QUEUE' ? '⚠' : a.type === 'LONG_WAIT' ? '⏱' : a.type.includes('OFFLINE') ? '🔴' : a.type.includes('BREAK') ? '☕' : '⚡'}</span>
              {a.message}
            </div>
          ))}
        </div>
      )}

      {/* ── Stats Bar ── */}
      {stats && (
        <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
          {[
            { label: 'Waiting', val: stats.waiting, color: 'text-amber-400' },
            { label: 'Called', val: stats.called, color: 'text-blue-400' },
            { label: 'Serving', val: stats.serving, color: 'text-emerald-400' },
            { label: 'Snoozed', val: stats.snoozed, color: 'text-purple-400' },
            { label: 'Skipped', val: stats.skipped, color: 'text-orange-400' },
            { label: 'No-Show', val: stats.noShow, color: 'text-red-400' },
            { label: 'Done', val: stats.completed, color: 'text-slate-400' },
            { label: 'ETA', val: `${stats.estimatedWaitMin}m`, color: 'text-indigo-400' },
          ].map(({ label, val, color }) => (
            <div key={label} className="bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-center">
              <div className={`text-xl font-black ${color}`}>{val}</div>
              <div className="text-[10px] text-slate-500 font-medium">{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── Tabs ── */}
      <div className="flex gap-1 bg-slate-900 border border-slate-800 rounded-xl p-1">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition ${activeTab === t.id ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Overview Tab ── */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Active Serving */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-2">
            <p className="text-[10px] font-semibold text-emerald-500 uppercase tracking-widest">Currently Serving</p>
            {(tickets.serving || []).length === 0 && (tickets.called || []).length === 0 ? (
              <p className="text-xs text-slate-600 italic">No active service</p>
            ) : (
              [...(tickets.called || []), ...(tickets.serving || [])].map(t => (
                <div key={t._id} className="flex items-center gap-2 bg-slate-800/50 rounded-lg px-3 py-2">
                  <span className="font-mono font-bold text-sm">{t.ticketNumber}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold ${STATUS_COLORS[t.status]}`}>{t.status}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${PRIORITY_BADGE[t.priority]}`}>{t.priority}</span>
                  {t.serviceStartedAt && <span className="ml-auto text-[10px] text-slate-500">{formatDuration(t.serviceStartedAt)}</span>}
                </div>
              ))
            )}
          </div>

          {/* Top of Queue */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-2">
            <p className="text-[10px] font-semibold text-amber-500 uppercase tracking-widest">Next in Queue</p>
            {(tickets.waiting || []).length === 0 ? (
              <p className="text-xs text-slate-600 italic">Queue is empty</p>
            ) : (
              (tickets.waiting || []).slice(0, 6).map((t, i) => (
                <div key={t._id} className="flex items-center gap-2 bg-slate-800/30 rounded-lg px-3 py-1.5">
                  <span className="text-[10px] text-slate-600 w-4">{i + 1}.</span>
                  <span className="font-mono font-bold text-sm">{t.ticketNumber}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${PRIORITY_BADGE[t.priority]}`}>{t.priority}</span>
                  <span className="ml-auto text-[10px] text-slate-500">wait {timeAgo(t.createdAt)}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* ── Queue Tab ── */}
      {activeTab === 'queue' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-slate-500">
                <th className="text-left px-4 py-2.5 font-semibold">#</th>
                <th className="text-left px-4 py-2.5 font-semibold">Ticket</th>
                <th className="text-left px-4 py-2.5 font-semibold">Priority</th>
                <th className="text-left px-4 py-2.5 font-semibold">Status</th>
                <th className="text-left px-4 py-2.5 font-semibold">Counter</th>
                <th className="text-right px-4 py-2.5 font-semibold">Waiting</th>
              </tr>
            </thead>
            <tbody>
              {[
                ...(tickets.called || []),
                ...(tickets.serving || []),
                ...(tickets.waiting || []),
                ...(tickets.snoozed || []),
              ].map((t, i) => (
                <tr key={t._id} className="border-b border-slate-800/50 hover:bg-slate-800/30 transition">
                  <td className="px-4 py-2 text-slate-600">{i + 1}</td>
                  <td className="px-4 py-2 font-mono font-bold">{t.ticketNumber}</td>
                  <td className="px-4 py-2"><span className={`px-1.5 py-0.5 rounded-full font-semibold text-[10px] ${PRIORITY_BADGE[t.priority]}`}>{t.priority}</span></td>
                  <td className="px-4 py-2"><span className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold ${STATUS_COLORS[t.status]}`}>{t.status}</span></td>
                  <td className="px-4 py-2 text-slate-400">{t.counterNumber ? `C${t.counterNumber}` : '—'}</td>
                  <td className="px-4 py-2 text-right text-slate-500">{timeAgo(t.createdAt)}</td>
                </tr>
              ))}
              {!tickets.waiting?.length && !tickets.called?.length && !tickets.serving?.length && (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-600 italic">Queue is empty</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Counters Tab ── */}
      {activeTab === 'counters' && (
        <div className="space-y-3">
          {counters.length === 0 ? (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 text-center text-slate-600 italic">
              No counters configured for this department.
            </div>
          ) : counters.map(c => (
            <div key={c._id} className={`bg-slate-900 border rounded-2xl p-4 ${c.status === 'AVAILABLE' ? 'border-emerald-800/40' : c.status === 'BUSY' ? 'border-blue-800/40' : c.status === 'PAUSED' ? 'border-amber-800/40' : 'border-slate-800'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-base font-black">{c.name || `Counter ${c.counterNumber}`}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold ${COUNTER_STATUS_COLORS[c.status] || 'bg-slate-800 text-slate-400'}`}>
                      {c.status}
                    </span>
                  </div>
                  <div className="text-xs text-slate-400">
                    Worker: <span className="font-semibold text-slate-300">{c.assignedWorkerId?.name || '— Unassigned —'}</span>
                    {c.assignedWorkerId?.status && (
                      <span className={`ml-2 text-[10px] ${c.assignedWorkerId.status === 'ON_BREAK' ? 'text-amber-400' : 'text-slate-500'}`}>
                        [{c.assignedWorkerId.status}]
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  {c.currentTicketId ? (
                    <div className="space-y-0.5">
                      <p className="font-mono font-black text-lg text-indigo-400">{c.currentTicketId.ticketNumber}</p>
                      <p className="text-[10px] text-slate-500">{c.currentTicketId.status}</p>
                      {c.currentTicketId.serviceStartedAt && (
                        <p className="text-[10px] text-emerald-500">{formatDuration(c.currentTicketId.serviceStartedAt)}</p>
                      )}
                    </div>
                  ) : (
                    <span className="text-xs text-slate-600 italic">Idle</span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Activity Tab ── */}
      {activeTab === 'activity' && (
        <div className="space-y-3">
          {/* Skipped */}
          {(tickets.skipped || []).length > 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
              <p className="text-[10px] font-semibold text-orange-500 uppercase tracking-widest mb-2">Skipped Tickets</p>
              <div className="space-y-1">
                {tickets.skipped.map(t => (
                  <div key={t._id} className="flex items-center gap-2 bg-orange-950/20 border border-orange-800/30 rounded-lg px-3 py-1.5">
                    <span className="font-mono font-bold text-sm text-orange-300">{t.ticketNumber}</span>
                    <span className="text-[10px] text-slate-500 ml-auto">{timeAgo(t.updatedAt)} ago</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* No-Show */}
          {(tickets.noShow || []).length > 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
              <p className="text-[10px] font-semibold text-red-500 uppercase tracking-widest mb-2">No-Show Tickets</p>
              <div className="space-y-1">
                {tickets.noShow.map(t => (
                  <div key={t._id} className="flex items-center gap-2 bg-red-950/20 border border-red-800/30 rounded-lg px-3 py-1.5">
                    <span className="font-mono font-bold text-sm text-red-300">{t.ticketNumber}</span>
                    <span className="text-[10px] text-slate-500 ml-auto">{timeAgo(t.updatedAt)} ago</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Transferred */}
          {(tickets.transferred || []).length > 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
              <p className="text-[10px] font-semibold text-cyan-500 uppercase tracking-widest mb-2">Transferred Out</p>
              <div className="space-y-1">
                {tickets.transferred.map(t => (
                  <div key={t._id} className="flex items-center gap-2 bg-cyan-950/20 border border-cyan-800/30 rounded-lg px-3 py-1.5">
                    <span className="font-mono font-bold text-sm text-cyan-300">{t.ticketNumber}</span>
                    <span className="text-[10px] text-slate-500 ml-auto">{timeAgo(t.updatedAt)} ago</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recent Completed */}
          {(tickets.completed || []).length > 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
              <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mb-2">Recently Completed</p>
              <div className="space-y-1">
                {tickets.completed.slice(0, 10).map(t => (
                  <div key={t._id} className="flex items-center gap-2 bg-slate-800/40 rounded-lg px-3 py-1.5">
                    <span className="font-mono font-bold text-sm text-slate-400">{t.ticketNumber}</span>
                    <span className="text-[10px] text-slate-600 ml-auto">{timeAgo(t.completedAt)} ago</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!tickets.skipped?.length && !tickets.noShow?.length && !tickets.transferred?.length && !tickets.completed?.length && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 text-center text-slate-600 italic">
              No activity yet for this department.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
