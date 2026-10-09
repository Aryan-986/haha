import React, { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';
import { 
  Play, CheckCircle2, PhoneForwarded, Bell, SkipForward, UserX, Clock, 
  Coffee, RefreshCw, AlertCircle, ArrowRightLeft, Users, Monitor
} from 'lucide-react';
import KioskHardwareSimulator from '../components/KioskHardwareSimulator';

const API = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api/v1';
const SOCKET_URL = 'http://localhost:5000';

const PRIORITY_BADGE = {
  NORMAL: 'bg-neutral-100 text-neutral-700 border-neutral-200',
  URGENT: 'bg-amber-50 text-amber-800 border-amber-200',
  EMERGENCY: 'bg-rose-50 text-rose-800 border-rose-200 animate-pulse',
};

function timeAgo(date) {
  if (!date) return '—';
  const secs = Math.floor((Date.now() - new Date(date)) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
}

export default function WorkerDashboard() {
  const isDev = import.meta.env.DEV || process.env.NODE_ENV !== 'production';

  const [orgs, setOrgs] = useState([]);
  const [orgId, setOrgId] = useState('');
  const [depts, setDepts] = useState([]);
  const [deptId, setDeptId] = useState('');
  const [counters, setCounters] = useState([]);
  const [counterId, setCounterId] = useState('');
  const [workers, setWorkers] = useState([]);
  const [workerId, setWorkerId] = useState('');

  const [currentTicket, setCurrentTicket] = useState(null);
  const [waitingTickets, setWaitingTickets] = useState([]);
  const [waitingCount, setWaitingCount] = useState(0);
  const [targetDeptId, setTargetDeptId] = useState('');
  const [snoozeMinutes, setSnoozeMinutes] = useState(5);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState({ text: '', type: 'info' });
  const [isBreak, setIsBreak] = useState(false);

  const socketRef = useRef(null);
  const prevScopeRef = useRef({ orgId: '', deptId: '' });

  // ── Socket.IO ──────────────────────────────────────────────────
  useEffect(() => {
    const socket = io(SOCKET_URL, { transports: ['websocket', 'polling'], reconnectionAttempts: 10 });
    socketRef.current = socket;

    socket.on('ticket.called', (p) => { if (p.deptId === deptId) fetchCurrent(); });
    socket.on('ticket.started', (p) => { if (p.deptId === deptId) fetchCurrent(); });
    socket.on('ticket.completed', (p) => { if (p.deptId === deptId) { setCurrentTicket(null); fetchCurrent(); } });
    socket.on('ticket.transferred', (p) => { if (p.fromDeptId === deptId || p.deptId === deptId) fetchCurrent(); });
    socket.on('ticket.recalled', (p) => { if (p.deptId === deptId && p.ticket) setCurrentTicket(p.ticket); });
    socket.on('queue.updated', (p) => { if (p.deptId === deptId || p.orgId === orgId) fetchCurrent(); });
    socket.on('counter.updated', (p) => { if (p.deptId === deptId) fetchCounters(); });
    socket.on('worker.updated', (p) => { if (p.workerId === workerId) fetchCurrent(); });

    return () => socket.disconnect();
  }, [deptId, orgId, workerId]);

  // Room subscription
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;
    const prev = prevScopeRef.current;
    socket.emit('switch_scope', { oldOrgId: prev.orgId, oldDeptId: prev.deptId, newOrgId: orgId, newDeptId: deptId });
    prevScopeRef.current = { orgId, deptId };
  }, [orgId, deptId]);

  // ── Data fetching ──────────────────────────────────────────────
  useEffect(() => {
    axios.get(`${API}/orgs`).then(r => {
      if (r.data?.length > 0) { setOrgs(r.data); setOrgId(r.data[0]._id); }
    }).catch(console.error).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!orgId) return;
    setCurrentTicket(null); setWaitingCount(0); setDeptId(''); setCounterId(''); setWorkerId('');
    Promise.all([
      axios.get(`${API}/orgs/${orgId}/departments`),
      axios.get(`${API}/worker/workers?orgId=${orgId}`)
    ]).then(([dr, wr]) => {
      const d = dr.data || []; setDepts(d);
      if (d.length > 0) setDeptId(d[0]._id);
      const w = wr.data?.workers || []; setWorkers(w);
      if (w.length > 0) setWorkerId(w[0]._id);
    }).catch(console.error);
  }, [orgId]);

  const fetchCounters = useCallback(() => {
    if (!deptId || !orgId) return;
    axios.get(`${API}/counters?organizationId=${orgId}&departmentId=${deptId}`)
      .then(r => {
        const c = r.data?.counters || []; setCounters(c);
        if (c.length > 0 && !counterId) setCounterId(c[0]._id);
      }).catch(console.error);
  }, [deptId, orgId, counterId]);

  const fetchCurrent = useCallback(() => {
    if (!deptId) return;
    axios.get(`${API}/worker/department/${deptId}/current`)
      .then(r => {
        setCurrentTicket(r.data?.ticket || null);
        setWaitingCount(r.data?.waitingCount || 0);
        setWaitingTickets(r.data?.waitingTickets || []);
      }).catch(console.error);
  }, [deptId]);

  useEffect(() => {
    fetchCounters(); fetchCurrent();
    const iv = setInterval(() => { fetchCurrent(); fetchCounters(); }, 5000);
    return () => clearInterval(iv);
  }, [fetchCurrent, fetchCounters]);

  // Check worker break state
  useEffect(() => {
    if (!workerId) return;
    const w = workers.find(w => w._id === workerId);
    setIsBreak(w?.status === 'ON_BREAK');
  }, [workerId, workers]);

  // ── Actions ────────────────────────────────────────────────────
  const action = async (label, fn) => {
    if (busy) return;
    setBusy(true); setStatusMsg({ text: '', type: 'info' });
    try {
      await fn();
      fetchCurrent();
    } catch (err) {
      setStatusMsg({ 
        text: err.response?.data?.error || err.message || `${label} failed`, 
        type: 'error' 
      });
    } finally {
      setBusy(false);
    }
  };

  const handleCallNext = () => action('Call Next', async () => {
    if (!deptId) return;
    const r = await axios.post(`${API}/worker/department/${deptId}/call-next`, { orgId, counterId, workerId });
    if (r.data?.ticket) {
      setCurrentTicket(r.data.ticket);
      setStatusMsg({ text: `Ticket called: ${r.data.ticketNumber}`, type: 'success' });
    } else {
      setStatusMsg({ text: 'Queue is empty — no waiting tickets.', type: 'info' });
    }
  });

  const handleStart = () => action('Start Service', async () => {
    if (!currentTicket) return;
    const r = await axios.post(`${API}/worker/tokens/start`, { ticketId: currentTicket._id, workerId, counterId });
    setCurrentTicket(r.data.ticket);
    setStatusMsg({ text: `Service started for ${r.data.ticket?.ticketNumber}`, type: 'success' });
  });

  const handleComplete = () => action('Complete Service', async () => {
    if (!currentTicket) return;
    await axios.post(`${API}/worker/tokens/complete`, { ticketId: currentTicket._id, workerId, counterId });
    setCurrentTicket(null);
    setStatusMsg({ text: 'Service completed successfully. Ready for next ticket.', type: 'success' });
  });

  const handleTransfer = () => action('Transfer Ticket', async () => {
    if (!currentTicket || !targetDeptId) return;
    const r = await axios.post(`${API}/worker/tokens/transfer`, {
      ticketId: currentTicket._id, targetDeptId, workerId, counterId
    });
    setCurrentTicket(null); setTargetDeptId('');
    setStatusMsg({ text: r.data?.message || 'Ticket transferred to next department.', type: 'success' });
  });

  const handleSnooze = () => action('Snooze Ticket', async () => {
    if (!currentTicket) return;
    await axios.post(`${API}/worker/tokens/snooze`, {
      ticketId: currentTicket._id, minutes: snoozeMinutes, workerId
    });
    setCurrentTicket(null);
    setStatusMsg({ text: `Ticket snoozed for ${snoozeMinutes} minutes.`, type: 'info' });
  });

  const handleSkip = () => action('Skip Ticket', async () => {
    if (!currentTicket) return;
    await axios.post(`${API}/worker/tokens/skip`, { ticketId: currentTicket._id, workerId, counterId });
    setCurrentTicket(null);
    setStatusMsg({ text: 'Ticket skipped and returned to queue.', type: 'info' });
  });

  const handleNoShow = () => action('Mark No Show', async () => {
    if (!currentTicket) return;
    await axios.post(`${API}/worker/tokens/no-show`, { ticketId: currentTicket._id, workerId, counterId });
    setCurrentTicket(null);
    setStatusMsg({ text: 'Ticket marked as No Show.', type: 'info' });
  });

  const handleRecall = () => action('Recall Citizen', async () => {
    if (!currentTicket) return;
    await axios.post(`${API}/worker/tokens/recall`, { ticketId: currentTicket._id, workerId, counterId });
    setStatusMsg({ text: `Citizen recalled for ticket ${currentTicket.ticketNumber}.`, type: 'success' });
  });

  const handleBreak = async () => {
    try {
      if (isBreak) {
        await axios.post(`${API}/worker/break-end`, { workerId, organizationId: orgId });
        setIsBreak(false);
        setStatusMsg({ text: 'Break ended. Counter is ready.', type: 'success' });
      } else {
        await axios.post(`${API}/worker/break`, { workerId, organizationId: orgId });
        setIsBreak(true);
        setStatusMsg({ text: 'Break started. Queue calling is paused.', type: 'info' });
      }
      const wr = await axios.get(`${API}/worker/workers?orgId=${orgId}`);
      setWorkers(wr.data?.workers || []);
      fetchCounters();
    } catch (err) {
      setStatusMsg({ text: err.response?.data?.error || 'Break toggle failed', type: 'error' });
    }
  };

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto p-12 text-center text-neutral-500">
        <RefreshCw className="w-8 h-8 mx-auto animate-spin mb-3 text-neutral-400" />
        <p className="text-sm font-medium">Loading worker dashboard...</p>
      </div>
    );
  }

  const activeDept = depts.find(d => d._id === deptId);
  const activeCounter = counters.find(c => c._id === counterId);
  const activeWorker = workers.find(w => w._id === workerId);
  const canOperate = !isBreak && deptId;
  const isServing = currentTicket?.status === 'SERVING';
  const isCalled = currentTicket?.status === 'CALLED';

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-6 bg-white min-h-screen text-neutral-900 font-sans">
      
      {/* ── 1. Assigned Counter and Worker Status ── */}
      <section className="border border-neutral-200 rounded-xl p-5 bg-white shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-neutral-100">
          <div>
            <h1 className="text-xl font-bold text-neutral-900">Worker Dashboard</h1>
            <p className="text-xs text-neutral-500 mt-0.5">Manage customer counter flow and service lifecycle</p>
          </div>
          
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border ${
              isBreak 
                ? 'bg-amber-50 text-amber-800 border-amber-200' 
                : 'bg-emerald-50 text-emerald-800 border-emerald-200'
            }`}>
              <span className={`w-2 h-2 rounded-full ${isBreak ? 'bg-amber-500' : 'bg-emerald-600'}`}></span>
              {isBreak ? 'On Break' : 'Active & Serving'}
            </span>

            <button 
              onClick={handleBreak} 
              disabled={!workerId}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
                isBreak 
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-800 hover:bg-emerald-100' 
                  : 'bg-neutral-50 border-neutral-200 text-neutral-700 hover:bg-neutral-100'
              }`}
            >
              <Coffee className="w-3.5 h-3.5" />
              {isBreak ? 'End Break' : 'Take Break'}
            </button>
          </div>
        </div>

        {/* Scope Selectors */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-semibold text-neutral-600 mb-1">Office / Org</label>
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

          <div>
            <label className="block text-xs font-semibold text-neutral-600 mb-1">Counter</label>
            <select 
              value={counterId} 
              onChange={e => setCounterId(e.target.value)}
              className="w-full bg-white border border-neutral-200 text-xs rounded-lg p-2 text-neutral-900 focus:outline-none focus:ring-1 focus:ring-emerald-700"
            >
              <option value="">— None Assigned —</option>
              {counters.map(c => (
                <option key={c._id} value={c._id}>
                  {c.name || `Counter ${c.counterNumber}`} ({c.status})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-neutral-600 mb-1">Worker</label>
            <select 
              value={workerId} 
              onChange={e => setWorkerId(e.target.value)}
              className="w-full bg-white border border-neutral-200 text-xs rounded-lg p-2 text-neutral-900 focus:outline-none focus:ring-1 focus:ring-emerald-700"
            >
              <option value="">— Select Worker —</option>
              {workers.map(w => (
                <option key={w._id} value={w._id}>
                  {w.name} ({w.role}){w.status === 'ON_BREAK' ? ' · Break' : ''}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Counter status in plain language */}
        {activeCounter && (
          <div className="flex items-center justify-between text-xs bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-2 text-neutral-700">
            <div className="flex items-center gap-2">
              <Monitor className="w-4 h-4 text-neutral-500" />
              <span>Assigned Counter: <strong>{activeCounter.name || `Counter ${activeCounter.counterNumber}`}</strong></span>
            </div>
            <span className="font-semibold text-neutral-800">
              Counter Status: <span className="capitalize">{activeCounter.status.toLowerCase()}</span>
            </span>
          </div>
        )}
      </section>

      {/* ── Status Message Alert ── */}
      {statusMsg.text && (
        <div className={`p-3 rounded-lg text-xs font-medium flex items-center gap-2 border ${
          statusMsg.type === 'error' 
            ? 'bg-rose-50 text-rose-800 border-rose-200' 
            : statusMsg.type === 'success' 
            ? 'bg-emerald-50 text-emerald-800 border-emerald-200' 
            : 'bg-neutral-50 text-neutral-800 border-neutral-200'
        }`}>
          {statusMsg.type === 'error' ? (
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          ) : statusMsg.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          ) : (
            <RefreshCw className="w-4 h-4 text-neutral-500 shrink-0" />
          )}
          <span>{statusMsg.text}</span>
        </div>
      )}

      {/* ── 2. Current Ticket ── */}
      <section className="border border-neutral-200 rounded-xl p-6 bg-white shadow-sm text-center space-y-4">
        <div>
          <span className="text-xs font-semibold tracking-wider uppercase text-neutral-500">
            {activeDept?.name || 'Department'} {activeDept?.roomNumber ? `· Room ${activeDept.roomNumber}` : ''}
          </span>
          <p className="text-xs text-neutral-500 mt-1">Current Ticket</p>
        </div>

        {currentTicket ? (
          <div className="space-y-3">
            <div className="text-5xl sm:text-6xl font-extrabold tracking-tight text-neutral-900 font-mono">
              {currentTicket.ticketNumber}
            </div>

            <div className="flex flex-wrap items-center justify-center gap-2">
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${
                currentTicket.status === 'SERVING' 
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-300' 
                  : 'bg-blue-50 text-blue-800 border-blue-300'
              }`}>
                {currentTicket.status === 'SERVING' ? 'Service in Progress' : 'Ticket Called (Waiting to Start)'}
              </span>

              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${PRIORITY_BADGE[currentTicket.priority] || ''}`}>
                {currentTicket.priority} Priority
              </span>

              {currentTicket.serviceStartedAt && (
                <span className="text-xs text-neutral-500 inline-flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" />
                  Started {timeAgo(currentTicket.serviceStartedAt)}
                </span>
              )}
            </div>
          </div>
        ) : (
          <div className="py-6 space-y-2">
            <div className="text-4xl sm:text-5xl font-bold text-neutral-300 font-mono tracking-widest">
              — — —
            </div>
            <p className="text-xs text-neutral-500">No active ticket at this counter.</p>
          </div>
        )}

        <div className="pt-2 text-xs text-neutral-500 border-t border-neutral-100 flex items-center justify-center gap-1.5">
          <Users className="w-4 h-4 text-neutral-400" />
          <span>
            {waitingCount > 0 ? (
              <strong>{waitingCount} ticket{waitingCount !== 1 ? 's' : ''} waiting in queue</strong>
            ) : (
              'Queue is currently empty'
            )}
          </span>
        </div>
      </section>

      {/* ── 3. Primary Action (State-based prominence) ── */}
      <section className="space-y-2">
        <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">Primary Action</p>
        
        {!currentTicket && (
          <button 
            onClick={handleCallNext} 
            disabled={!canOperate || busy || waitingCount === 0}
            className="w-full py-4 bg-emerald-700 hover:bg-emerald-800 active:bg-emerald-900 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-base rounded-xl transition shadow-sm flex items-center justify-center gap-2"
          >
            <Play className="w-5 h-5 fill-current" />
            <span>Call Next</span>
          </button>
        )}

        {isCalled && (
          <button 
            onClick={handleStart} 
            disabled={!canOperate || busy}
            className="w-full py-4 bg-emerald-700 hover:bg-emerald-800 active:bg-emerald-900 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-base rounded-xl transition shadow-sm flex items-center justify-center gap-2"
          >
            <Play className="w-5 h-5 fill-current" />
            <span>Start Service</span>
          </button>
        )}

        {isServing && (
          <button 
            onClick={handleComplete} 
            disabled={!canOperate || busy}
            className="w-full py-4 bg-emerald-700 hover:bg-emerald-800 active:bg-emerald-900 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-base rounded-xl transition shadow-sm flex items-center justify-center gap-2"
          >
            <CheckCircle2 className="w-5 h-5" />
            <span>Complete Service</span>
          </button>
        )}
      </section>

      {/* ── 4. Next Tickets in Queue ── */}
      <section className="border border-neutral-200 rounded-xl p-5 bg-white shadow-sm space-y-3">
        <div className="flex items-center justify-between pb-2 border-b border-neutral-100">
          <h2 className="text-sm font-bold text-neutral-900">Next Tickets in Queue</h2>
          <span className="text-xs text-neutral-500 font-medium">{waitingCount} Waiting</span>
        </div>

        {waitingTickets.length > 0 ? (
          <div className="divide-y divide-neutral-100">
            {waitingTickets.slice(0, 5).map((t, idx) => (
              <div key={t._id} className="py-2.5 flex items-center justify-between text-xs">
                <div className="flex items-center gap-3">
                  <span className="w-6 text-neutral-400 font-mono font-medium">{idx + 1}.</span>
                  <span className="font-mono font-bold text-neutral-900 text-sm">{t.ticketNumber}</span>
                  <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${PRIORITY_BADGE[t.priority]}`}>
                    {t.priority}
                  </span>
                </div>
                <span className="text-neutral-500">{timeAgo(t.createdAt)}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="py-6 text-center text-xs text-neutral-500">
            No customers currently waiting in this department.
          </div>
        )}
      </section>

      {/* ── 5. Secondary Actions (Compact & clearly labeled) ── */}
      {currentTicket && (
        <section className="border border-neutral-200 rounded-xl p-5 bg-neutral-50 shadow-sm space-y-4">
          <h3 className="text-xs font-bold text-neutral-700 uppercase tracking-wider">Secondary Actions</h3>

          {/* Quick status management buttons */}
          <div className="grid grid-cols-3 gap-2">
            <button 
              onClick={handleRecall} 
              disabled={!canOperate || busy || !isCalled}
              className="py-2 px-3 bg-white border border-neutral-200 hover:bg-neutral-100 disabled:opacity-40 text-neutral-800 text-xs font-medium rounded-lg transition inline-flex items-center justify-center gap-1.5"
            >
              <Bell className="w-3.5 h-3.5 text-neutral-600" />
              <span>Recall</span>
            </button>

            <button 
              onClick={handleSkip} 
              disabled={!canOperate || busy || !isCalled}
              className="py-2 px-3 bg-white border border-neutral-200 hover:bg-neutral-100 disabled:opacity-40 text-neutral-800 text-xs font-medium rounded-lg transition inline-flex items-center justify-center gap-1.5"
            >
              <SkipForward className="w-3.5 h-3.5 text-neutral-600" />
              <span>Skip</span>
            </button>

            <button 
              onClick={handleNoShow} 
              disabled={!canOperate || busy || !isCalled}
              className="py-2 px-3 bg-white border border-neutral-200 hover:bg-neutral-100 disabled:opacity-40 text-rose-700 hover:text-rose-800 text-xs font-medium rounded-lg transition inline-flex items-center justify-center gap-1.5"
            >
              <UserX className="w-3.5 h-3.5 text-rose-600" />
              <span>No Show</span>
            </button>
          </div>

          {/* Snooze control */}
          <div className="pt-2 border-t border-neutral-200/60 flex flex-wrap items-center gap-2 text-xs">
            <span className="font-medium text-neutral-600">Snooze:</span>
            {[3, 5, 10, 15].map(m => (
              <button 
                key={m} 
                onClick={() => setSnoozeMinutes(m)}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold transition border ${
                  snoozeMinutes === m 
                    ? 'bg-neutral-800 text-white border-neutral-800' 
                    : 'bg-white text-neutral-700 border-neutral-200 hover:bg-neutral-100'
                }`}
              >
                {m}m
              </button>
            ))}
            <button 
              onClick={handleSnooze} 
              disabled={!canOperate || busy}
              className="ml-auto px-3 py-1 bg-white border border-neutral-200 hover:bg-neutral-100 disabled:opacity-40 text-neutral-800 text-xs font-medium rounded-lg transition inline-flex items-center gap-1"
            >
              <Clock className="w-3.5 h-3.5 text-neutral-600" />
              <span>Snooze {snoozeMinutes}m</span>
            </button>
          </div>

          {/* Transfer control */}
          <div className="pt-2 border-t border-neutral-200/60 space-y-2">
            <label className="block text-xs font-semibold text-neutral-600">Transfer Ticket to Another Department</label>
            <div className="flex gap-2">
              <select 
                value={targetDeptId} 
                onChange={e => setTargetDeptId(e.target.value)}
                className="flex-1 bg-white border border-neutral-200 text-xs rounded-lg p-2 text-neutral-900 focus:outline-none focus:ring-1 focus:ring-emerald-700"
              >
                <option value="">— Select destination department —</option>
                {depts.filter(d => d._id !== deptId).map(d => (
                  <option key={d._id} value={d._id}>
                    {d.name} ({d.prefix}){d.roomNumber ? ` · Room ${d.roomNumber}` : ''}
                  </option>
                ))}
              </select>
              <button 
                onClick={handleTransfer} 
                disabled={!targetDeptId || !canOperate || busy}
                className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-40 text-white text-xs font-semibold rounded-lg transition inline-flex items-center gap-1.5"
              >
                <ArrowRightLeft className="w-3.5 h-3.5" />
                <span>Transfer</span>
              </button>
            </div>
          </div>
        </section>
      )}

      {/* ── 6. Development Tools — Kiosk Simulator ── */}
      {isDev && (
        <section className="pt-4 border-t border-neutral-200">
          <KioskHardwareSimulator 
            orgId={orgId} 
            deptId={deptId} 
            onDispense={fetchCurrent} 
          />
        </section>
      )}

    </div>
  );
}