import React, { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';

const API = 'http://localhost:5000/api/v1';
const SOCKET_URL = 'http://localhost:5000';

const STATUS_COLORS = {
  WAITING: 'text-amber-400',
  CALLED: 'text-blue-400',
  SERVING: 'text-emerald-400',
  COMPLETED: 'text-slate-400',
  SNOOZED: 'text-purple-400',
  SKIPPED: 'text-orange-400',
  NO_SHOW: 'text-red-400',
  TRANSFERRED: 'text-cyan-400',
};

const PRIORITY_BADGE = {
  NORMAL: 'bg-slate-700 text-slate-300',
  URGENT: 'bg-amber-900/60 text-amber-300 border border-amber-600/40',
  EMERGENCY: 'bg-red-900/60 text-red-300 border border-red-600/40 animate-pulse',
};

function timeAgo(date) {
  if (!date) return '—';
  const secs = Math.floor((Date.now() - new Date(date)) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
}

export default function WorkerDashboard() {
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
  const [statusMsg, setStatusMsg] = useState('');
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
    setBusy(true); setStatusMsg('');
    try {
      await fn();
      fetchCurrent();
    } catch (err) {
      setStatusMsg(err.response?.data?.error || err.message || `${label} failed`);
    } finally {
      setBusy(false);
    }
  };

  const handleCallNext = () => action('Call Next', async () => {
    if (!deptId) return;
    const r = await axios.post(`${API}/worker/department/${deptId}/call-next`, { orgId, counterId, workerId });
    if (r.data?.ticket) {
      setCurrentTicket(r.data.ticket);
      setStatusMsg(`📣 Now serving: ${r.data.ticketNumber}`);
    } else {
      setStatusMsg('Queue is empty — no waiting tickets.');
    }
  });

  const handleStart = () => action('Start', async () => {
    if (!currentTicket) return;
    const r = await axios.post(`${API}/worker/tokens/start`, { ticketId: currentTicket._id, workerId, counterId });
    setCurrentTicket(r.data.ticket);
    setStatusMsg(`▶ Service started for ${r.data.ticket?.ticketNumber}`);
  });

  const handleComplete = () => action('Complete', async () => {
    if (!currentTicket) return;
    await axios.post(`${API}/worker/tokens/complete`, { ticketId: currentTicket._id, workerId, counterId });
    setCurrentTicket(null);
    setStatusMsg('✅ Service completed. Counter is available.');
  });

  const handleTransfer = () => action('Transfer', async () => {
    if (!currentTicket || !targetDeptId) return;
    const r = await axios.post(`${API}/worker/tokens/transfer`, {
      ticketId: currentTicket._id, targetDeptId, workerId, counterId
    });
    setCurrentTicket(null); setTargetDeptId('');
    setStatusMsg(r.data?.message || `Ticket transferred`);
  });

  const handleSnooze = () => action('Snooze', async () => {
    if (!currentTicket) return;
    const r = await axios.post(`${API}/worker/tokens/snooze`, {
      ticketId: currentTicket._id, minutes: snoozeMinutes, workerId
    });
    setCurrentTicket(null);
    setStatusMsg(`💤 Ticket snoozed for ${snoozeMinutes} minutes.`);
  });

  const handleSkip = () => action('Skip', async () => {
    if (!currentTicket) return;
    await axios.post(`${API}/worker/tokens/skip`, { ticketId: currentTicket._id, workerId, counterId });
    setCurrentTicket(null);
    setStatusMsg('⏩ Ticket skipped.');
  });

  const handleNoShow = () => action('No Show', async () => {
    if (!currentTicket) return;
    await axios.post(`${API}/worker/tokens/no-show`, { ticketId: currentTicket._id, workerId, counterId });
    setCurrentTicket(null);
    setStatusMsg('❌ Ticket marked as no-show.');
  });

  const handleRecall = () => action('Recall', async () => {
    if (!currentTicket) return;
    await axios.post(`${API}/worker/tokens/recall`, { ticketId: currentTicket._id, workerId, counterId });
    setStatusMsg(`📢 Ticket ${currentTicket.ticketNumber} recalled.`);
  });

  const handleBreak = async () => {
    try {
      if (isBreak) {
        await axios.post(`${API}/worker/break-end`, { workerId, organizationId: orgId });
        setIsBreak(false); setStatusMsg('☕ Break ended — back to work.');
      } else {
        await axios.post(`${API}/worker/break`, { workerId, organizationId: orgId });
        setIsBreak(true); setStatusMsg('☕ Break started.');
      }
      const wr = await axios.get(`${API}/worker/workers?orgId=${orgId}`);
      setWorkers(wr.data?.workers || []);
      fetchCounters();
    } catch (err) {
      setStatusMsg(err.response?.data?.error || 'Break toggle failed');
    }
  };

  if (loading) return <div className="p-10 text-center text-slate-400">Loading Worker Portal...</div>;

  const activeDept = depts.find(d => d._id === deptId);
  const activeCounter = counters.find(c => c._id === counterId);
  const activeWorker = workers.find(w => w._id === workerId);
  const canOperate = !isBreak && deptId;
  const isServing = currentTicket?.status === 'SERVING';
  const isCalled = currentTicket?.status === 'CALLED';

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-4 text-slate-100 min-h-screen bg-slate-950">
      {/* ── Header ── */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold tracking-tight">Counter Staff Portal</h1>
          <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${isBreak ? 'bg-amber-900/40 text-amber-300 border border-amber-700/40' : 'bg-emerald-900/30 text-emerald-400 border border-emerald-700/30'}`}>
            {isBreak ? '☕ On Break' : '● Active'}
          </span>
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
              {depts.map(d => <option key={d._id} value={d._id}>{d.name} ({d.prefix}){d.roomNumber ? ` — Room ${d.roomNumber}` : ''}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">Counter</label>
            <select value={counterId} onChange={e => setCounterId(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 text-xs rounded-lg p-2 text-slate-200 focus:outline-none focus:border-indigo-500">
              <option value="">— None —</option>
              {counters.map(c => <option key={c._id} value={c._id}>{c.name || `Counter ${c.counterNumber}`} [{c.status}]</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">Worker</label>
            <select value={workerId} onChange={e => setWorkerId(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 text-xs rounded-lg p-2 text-slate-200 focus:outline-none focus:border-indigo-500">
              <option value="">— None —</option>
              {workers.map(w => <option key={w._id} value={w._id}>{w.name} [{w.role}]{w.status === 'ON_BREAK' ? ' ☕' : ''}</option>)}
            </select>
          </div>
        </div>

        {/* Counter status bar */}
        {activeCounter && (
          <div className="flex items-center gap-2 text-xs bg-slate-950 border border-slate-800 rounded-lg px-3 py-2">
            <span className="text-slate-500">Counter:</span>
            <span className="font-bold">{activeCounter.name || `Counter ${activeCounter.counterNumber}`}</span>
            <span className={`ml-auto px-2 py-0.5 rounded-full text-[10px] font-semibold ${
              activeCounter.status === 'AVAILABLE' ? 'bg-emerald-900/40 text-emerald-400' :
              activeCounter.status === 'BUSY' ? 'bg-blue-900/40 text-blue-400' :
              activeCounter.status === 'PAUSED' ? 'bg-amber-900/40 text-amber-400' :
              'bg-slate-700 text-slate-400'}`}>
              {activeCounter.status}
            </span>
          </div>
        )}
      </div>

      {/* ── Status Message ── */}
      {statusMsg && (
        <div className="bg-indigo-950/50 border border-indigo-700/40 text-indigo-300 px-4 py-2.5 rounded-xl text-sm text-center font-medium">
          {statusMsg}
        </div>
      )}

      {/* ── Current Ticket Card ── */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
        <div className="text-center space-y-1">
          <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest">
            Now Serving · {activeDept?.name || '—'}{activeDept?.roomNumber ? ` (Room ${activeDept.roomNumber})` : ''}
          </p>
          <div className={`text-6xl font-black tracking-tight my-2 ${currentTicket ? 'text-indigo-400' : 'text-slate-700'}`}>
            {currentTicket?.ticketNumber || '· · ·'}
          </div>
          {currentTicket && (
            <div className="flex items-center justify-center gap-2">
              <span className={`text-xs font-semibold ${STATUS_COLORS[currentTicket.status] || 'text-slate-400'}`}>
                {currentTicket.status}
              </span>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${PRIORITY_BADGE[currentTicket.priority]}`}>
                {currentTicket.priority}
              </span>
              {currentTicket.serviceStartedAt && (
                <span className="text-[10px] text-slate-500">
                  started {timeAgo(currentTicket.serviceStartedAt)}
                </span>
              )}
            </div>
          )}
          <p className="text-xs text-slate-600">
            {waitingCount > 0 ? `${waitingCount} ticket${waitingCount !== 1 ? 's' : ''} waiting in queue` : 'Queue is empty'}
          </p>
        </div>

        {/* ── Primary Action Buttons ── */}
        <div className="grid grid-cols-2 gap-2">
          <button onClick={handleCallNext} disabled={!canOperate || busy || isServing}
            className="col-span-2 py-3 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold rounded-xl transition text-sm">
            ✦ Call Next Ticket
          </button>
          <button onClick={handleStart} disabled={!canOperate || busy || !isCalled}
            className="py-2.5 bg-blue-700 hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition text-sm">
            ▶ Start Service
          </button>
          <button onClick={handleComplete} disabled={!canOperate || busy || !isServing}
            className="py-2.5 bg-indigo-700 hover:bg-indigo-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition text-sm">
            ✓ Complete
          </button>
        </div>

        {/* ── Secondary Action Buttons ── */}
        {currentTicket && (
          <div className="pt-3 border-t border-slate-800/70 space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <button onClick={handleRecall} disabled={!canOperate || busy || !isCalled}
                className="py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-300 text-xs font-semibold rounded-lg transition">
                📢 Recall
              </button>
              <button onClick={handleSkip} disabled={!canOperate || busy || !isCalled}
                className="py-2 bg-orange-900/40 hover:bg-orange-800/60 disabled:opacity-40 text-orange-400 text-xs font-semibold rounded-lg border border-orange-800/40 transition">
                ⏩ Skip
              </button>
              <button onClick={handleNoShow} disabled={!canOperate || busy || !isCalled}
                className="py-2 bg-red-900/40 hover:bg-red-800/60 disabled:opacity-40 text-red-400 text-xs font-semibold rounded-lg border border-red-800/40 transition">
                ✕ No Show
              </button>
            </div>

            {/* Snooze Control */}
            <div className="flex gap-2 items-center">
              <span className="text-xs text-slate-500 shrink-0">Snooze:</span>
              {[1, 3, 5, 10, 15].map(m => (
                <button key={m} onClick={() => setSnoozeMinutes(m)}
                  className={`text-[10px] px-2 py-1 rounded-lg font-semibold transition ${snoozeMinutes === m ? 'bg-purple-700 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}>
                  +{m}m
                </button>
              ))}
              <button onClick={handleSnooze} disabled={!canOperate || busy}
                className="ml-auto px-3 py-1.5 bg-purple-900/50 hover:bg-purple-800 disabled:opacity-40 text-purple-300 text-xs font-semibold rounded-lg border border-purple-700/40 transition">
                💤 Snooze {snoozeMinutes}m
              </button>
            </div>

            {/* Transfer Control */}
            <div className="flex gap-2 items-center pt-1">
              <span className="text-xs text-slate-500 shrink-0">Transfer to:</span>
              <select value={targetDeptId} onChange={e => setTargetDeptId(e.target.value)}
                className="flex-1 bg-slate-800 border border-slate-700 rounded-lg p-1.5 text-xs text-slate-200 focus:outline-none focus:border-amber-500">
                <option value="">— Select department —</option>
                {depts.filter(d => d._id !== deptId).map(d => (
                  <option key={d._id} value={d._id}>{d.name} ({d.prefix}){d.roomNumber ? ` — Room ${d.roomNumber}` : ''}</option>
                ))}
              </select>
              <button onClick={handleTransfer} disabled={!targetDeptId || !canOperate || busy}
                className="px-3 py-1.5 bg-amber-700/70 hover:bg-amber-600 disabled:opacity-40 text-amber-200 text-xs font-semibold rounded-lg transition whitespace-nowrap">
                ⇄ Transfer
              </button>
            </div>
          </div>
        )}

        {/* ── Break Button ── */}
        <div className="pt-2 border-t border-slate-800/50">
          <button onClick={handleBreak}
            className={`w-full py-2 text-xs font-semibold rounded-xl transition ${isBreak ? 'bg-emerald-900/50 hover:bg-emerald-800 text-emerald-400 border border-emerald-700/40' : 'bg-amber-900/30 hover:bg-amber-800/50 text-amber-400 border border-amber-700/30'}`}>
            {isBreak ? '▶ End Break & Resume' : '☕ Start Break'}
          </button>
        </div>
      </div>

      {/* ── Upcoming Queue ── */}
      {waitingTickets.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-2">
          <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest">Upcoming Queue</p>
          <div className="space-y-1.5">
            {waitingTickets.slice(0, 5).map((t, i) => (
              <div key={t._id} className="flex items-center gap-2 bg-slate-800/50 rounded-lg px-3 py-2">
                <span className="text-xs text-slate-600 w-4">{i + 1}.</span>
                <span className="font-mono font-bold text-sm text-slate-200">{t.ticketNumber}</span>
                <span className={`ml-auto text-[10px] px-2 py-0.5 rounded-full font-semibold ${PRIORITY_BADGE[t.priority]}`}>{t.priority}</span>
                <span className="text-[10px] text-slate-500">{timeAgo(t.createdAt)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}