import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Ticket,
  Clock,
  Users,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Search,
  Check,
  Copy,
  ChevronDown,
  ChevronUp,
  ArrowRight,
  MapPin,
  Building2,
  Calendar,
  X,
  FastForward,
  Wifi,
  WifiOff
} from 'lucide-react';
import {
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
} from '../services/citizenService';
import { getSocket, onSocketReconnect, onSocketStatusChange } from '../services/socket';

const STORAGE_KEY = 'queueless_citizen_active_ticket';

export default function CitizenDashboard() {
  const [activeTab, setActiveTab] = useState('create'); // 'create' | 'ticket' | 'track'
  const [connectionError, setConnectionError] = useState(null);
  const [socketStatus, setSocketStatus] = useState('connected');
  const [delayLoading, setDelayLoading] = useState(false);

  // Organizations and Departments
  const [organizations, setOrganizations] = useState([]);
  const [selectedOrgId, setSelectedOrgId] = useState('');
  const [departments, setDepartments] = useState([]);
  const [selectedDeptId, setSelectedDeptId] = useState('');
  const [priority, setPriority] = useState('NORMAL');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Active Ticket state
  const [activeTicket, setActiveTicket] = useState(null);
  const [peopleAhead, setPeopleAhead] = useState(0);
  const [estimatedWaitMin, setEstimatedWaitMin] = useState(null);
  const [journeyData, setJourneyData] = useState(null);
  const [eventHistory, setEventHistory] = useState([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [copiedToken, setCopiedToken] = useState(false);

  // Status and feedback
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [feedback, setFeedback] = useState(null);

  // Lookup state
  const [lookupInput, setLookupInput] = useState('');
  const [lookupLoading, setLookupLoading] = useState(false);

  // Socket
  const socketRef = useRef(null);
  const ticketRef = useRef(activeTicket);
  ticketRef.current = activeTicket;

  // 1. Authoritative ticket loader (defined first so loadInitial can use it)
  const loadTicket = useCallback(async (idOrToken) => {
    if (!idOrToken) return;
    try {
      setIsRefreshing(true);
      let res = null;

      if (typeof idOrToken === 'string' && idOrToken.length === 32) {
        try {
          res = await trackTicketByToken(idOrToken);
        } catch {
          res = await getTicketDetails(idOrToken);
        }
      } else {
        res = await getTicketDetails(idOrToken);
      }

      if (!res || !res.ticket) {
        throw new Error('Ticket not found');
      }

      const t = res.ticket;
      setActiveTicket(t);

      // Persist in localStorage
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          _id: t._id,
          ticketNumber: t.ticketNumber,
          trackingToken: t.trackingToken
        })
      );

      // Parallel fetch for position, ETA, journey, and audit history
      const [pos, eta, journey, events] = await Promise.all([
        getTicketPosition(t._id).catch(() => ({ peopleAhead: 0, position: 1 })),
        getTicketETA(t._id).catch(() => ({ estimatedWaitMin: null, calculable: false })),
        getTicketJourney(t._id).catch(() => null),
        getTicketEvents(t._id).catch(() => [])
      ]);

      setPeopleAhead(pos?.peopleAhead ?? 0);
      setEstimatedWaitMin(eta?.calculable ? eta.estimatedWaitMin : null);
      setJourneyData(journey);
      setEventHistory(events);
    } catch (err) {
      console.error('Failed to load ticket:', err);
      setFeedback({ type: 'error', text: err.response?.data?.error || err.message || 'Ticket not found' });
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  // 2. Initial Load: Organizations & Persisted Ticket
  const loadInitial = useCallback(async () => {
    try {
      setLoading(true);
      setConnectionError(null);
      const orgs = await getCitizenOrganizations();
      const activeOrgs = (orgs || []).filter((o) => !o.isDeleted && o.status === 'ACTIVE');
      setOrganizations(activeOrgs);

      if (activeOrgs.length > 0) {
        setSelectedOrgId((prev) => prev || activeOrgs[0]._id);
      }

      // Check localStorage for saved ticket
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (parsed.trackingToken || parsed._id) {
            await loadTicket(parsed.trackingToken || parsed._id);
            setActiveTab('ticket');
          }
        } catch {
          localStorage.removeItem(STORAGE_KEY);
        }
      }
    } catch (err) {
      console.error('Failed to load initial citizen data:', err);
      setConnectionError('Unable to connect to QueueLess backend service. Please verify the server is running and retry.');
    } finally {
      setLoading(false);
    }
  }, [loadTicket]);

  useEffect(() => {
    loadInitial();
  }, [loadInitial]);

  // 3. Load Departments when Organization changes
  useEffect(() => {
    if (!selectedOrgId) {
      setDepartments([]);
      setSelectedDeptId('');
      return;
    }

    async function loadDepts() {
      try {
        const depts = await getCitizenDepartments(selectedOrgId);
        setDepartments(depts || []);
        if (depts && depts.length > 0) {
          setSelectedDeptId(depts[0]._id);
        } else {
          setSelectedDeptId('');
        }
      } catch (err) {
        console.error('Error fetching departments:', err);
        setDepartments([]);
      }
    }
    loadDepts();
  }, [selectedOrgId]);

  // 4. Request ticket snooze / delay
  const handleRequestDelay = async (minutes = 5) => {
    if (!activeTicket || delayLoading) return;
    try {
      setDelayLoading(true);
      await snoozeCitizenTicket(activeTicket._id, minutes);
      await loadTicket(activeTicket._id);
      setFeedback({
        type: 'success',
        text: `Delay requested. Your turn has been delayed by ${minutes} minutes.`
      });
    } catch (err) {
      console.error('Failed to request delay:', err);
      setFeedback({
        type: 'error',
        text: err.response?.data?.error || err.message || 'Failed to request delay'
      });
    } finally {
      setDelayLoading(false);
    }
  };

  // 5. Shared Socket.IO Real-time Subscriptions
  useEffect(() => {
    const socket = getSocket();
    socketRef.current = socket;

    const unregStatus = onSocketStatusChange((status) => {
      setSocketStatus(status);
    });

    const unregReconnect = onSocketReconnect(() => {
      if (ticketRef.current) {
        loadTicket(ticketRef.current._id);
      }
    });

    if (ticketRef.current) {
      socket.emit('join_ticket', {
        ticketId: ticketRef.current._id,
        trackingToken: ticketRef.current.trackingToken
      });
    }

    const handleUpdate = (payload) => {
      const current = ticketRef.current;
      if (!current) return;
      const pId = payload.ticket?._id?.toString() || payload.ticketId?.toString();
      const pNum = payload.ticketNumber || payload.ticket?.ticketNumber;

      if (pId === current._id?.toString() || pNum === current.ticketNumber) {
        loadTicket(current._id);
      }
    };

    socket.on('ticket.called', handleUpdate);
    socket.on('ticket.started', handleUpdate);
    socket.on('ticket.completed', handleUpdate);
    socket.on('ticket.transferred', handleUpdate);
    socket.on('ticket.snoozed', handleUpdate);
    socket.on('ticket.resumed', handleUpdate);
    socket.on('ticket.skipped', handleUpdate);
    socket.on('queue.updated', () => {
      if (ticketRef.current) {
        loadTicket(ticketRef.current._id);
      }
    });

    return () => {
      unregStatus();
      unregReconnect();
      socket.off('ticket.called', handleUpdate);
      socket.off('ticket.started', handleUpdate);
      socket.off('ticket.completed', handleUpdate);
      socket.off('ticket.transferred', handleUpdate);
      socket.off('ticket.snoozed', handleUpdate);
      socket.off('ticket.resumed', handleUpdate);
      socket.off('ticket.skipped', handleUpdate);
    };
  }, [loadTicket]);

  // When active ticket changes, join the socket room
  useEffect(() => {
    if (socketRef.current && socketRef.current.connected && activeTicket) {
      socketRef.current.emit('join_ticket', {
        ticketId: activeTicket._id,
        trackingToken: activeTicket.trackingToken
      });
    }
  }, [activeTicket]);

  // 5. Issue real ticket (Step 3 action)
  const handleGetTicket = async (e) => {
    e.preventDefault();
    if (!selectedOrgId || !selectedDeptId) {
      setFeedback({ type: 'error', text: 'Please select an office and a service first.' });
      return;
    }

    try {
      setIsSubmitting(true);
      setFeedback(null);

      const idempotencyKey = `idem_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

      const res = await issueCitizenTicket({
        organizationId: selectedOrgId,
        departmentId: selectedDeptId,
        priority,
        source: 'WEB',
        idempotencyKey
      });

      if (!res.ticket) {
        throw new Error(res.error || 'Failed to issue ticket');
      }

      await loadTicket(res.ticket._id);
      setActiveTab('ticket');
      setFeedback({
        type: 'success',
        text: `Your ticket ${res.ticket.ticketNumber} is ready!`
      });
    } catch (err) {
      console.error('Ticket issue error:', err);
      setFeedback({
        type: 'error',
        text: err.response?.data?.error || err.message || 'Unable to create ticket. Please try again.'
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // 6. Manual Ticket Lookup
  const handleLookup = async (e) => {
    e.preventDefault();
    const query = lookupInput.trim();
    if (!query) return;

    try {
      setLookupLoading(true);
      setFeedback(null);
      await loadTicket(query);
      setActiveTab('ticket');
      setLookupInput('');
    } catch (err) {
      setFeedback({
        type: 'error',
        text: 'No active ticket found. Please check the ticket number or token.'
      });
    } finally {
      setLookupLoading(false);
    }
  };

  const handleDismissTicket = () => {
    if (window.confirm('Do you want to clear this ticket from your screen? Your record will remain saved in the system.')) {
      localStorage.removeItem(STORAGE_KEY);
      setActiveTicket(null);
      setJourneyData(null);
      setEventHistory([]);
      setActiveTab('create');
    }
  };

  const copyToken = () => {
    if (!activeTicket?.trackingToken) return;
    navigator.clipboard.writeText(activeTicket.trackingToken);
    setCopiedToken(true);
    setTimeout(() => setCopiedToken(false), 2000);
  };

  // Plain-language next instruction based on authoritative backend status
  const getNextInstruction = (status) => {
    switch (status) {
      case 'CALLED':
        return `Your ticket has been called. Please go to ${
          activeTicket?.counter?.counterNumber || activeTicket?.counterNumber
            ? `Counter ${activeTicket.counter?.counterNumber || activeTicket.counterNumber}`
            : 'your counter'
        }${activeTicket?.roomNumber ? ` in Room ${activeTicket.roomNumber}` : ''}.`;
      case 'SERVING':
        return 'Your service is in progress.';
      case 'TRANSFERRED':
        return `Please proceed to ${activeTicket?.department?.name || 'the next department'}${
          activeTicket?.roomNumber ? ` (Room ${activeTicket.roomNumber})` : ''
        }.`;
      case 'SNOOZED':
        return 'Your ticket is temporarily delayed. We will recall you shortly.';
      case 'COMPLETED':
        return 'Your service is complete. Thank you.';
      case 'SKIPPED':
        return 'Your ticket was passed. Please speak with reception staff.';
      case 'NO_SHOW':
        return 'You were marked as no-show. Please visit reception if you are still present.';
      case 'CANCELLED':
        return 'This ticket has been cancelled.';
      case 'WAITING':
      default:
        return 'Please wait. We will call your ticket.';
    }
  };

  const getStatusLabel = (status) => {
    switch (status) {
      case 'CALLED': return 'Please Proceed to Counter';
      case 'SERVING': return 'Service in Progress';
      case 'TRANSFERRED': return 'Transferred to Next Step';
      case 'SNOOZED': return 'Temporarily Delayed';
      case 'COMPLETED': return 'Completed';
      case 'SKIPPED': return 'Skipped';
      case 'NO_SHOW': return 'No Show';
      case 'CANCELLED': return 'Cancelled';
      case 'WAITING':
      default: return 'Waiting in queue';
    }
  };

  if (loading) {
    return (
      <div className="py-20 text-center text-gray-500 text-sm flex flex-col items-center gap-2">
        <RefreshCw className="w-5 h-5 animate-spin text-emerald-700" />
        <span>Loading QueueLess...</span>
      </div>
    );
  }

  const selectedOrg = organizations.find((o) => o._id === selectedOrgId);
  const selectedDept = departments.find((d) => d._id === selectedDeptId);

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      {/* Top Simple Navigation Tabs */}
      <div className="flex items-center justify-between border-b border-gray-200 pb-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('create')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
              activeTab === 'create'
                ? 'bg-emerald-700 text-white'
                : 'text-gray-600 hover:text-neutral-900 hover:bg-gray-100'
            }`}
          >
            Get a Ticket
          </button>

          {activeTicket && (
            <button
              type="button"
              onClick={() => setActiveTab('ticket')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                activeTab === 'ticket'
                  ? 'bg-emerald-700 text-white'
                  : 'text-emerald-700 font-bold hover:bg-emerald-50'
              }`}
            >
              My Ticket ({activeTicket.ticketNumber})
            </button>
          )}

          <button
            type="button"
            onClick={() => setActiveTab('track')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
              activeTab === 'track'
                ? 'bg-emerald-700 text-white'
                : 'text-gray-600 hover:text-neutral-900 hover:bg-gray-100'
            }`}
          >
            Track Existing
          </button>
        </div>

        {activeTicket && activeTab === 'ticket' && (
          <button
            type="button"
            onClick={() => loadTicket(activeTicket._id)}
            disabled={isRefreshing}
            className="flex items-center gap-1 text-xs text-gray-600 hover:text-neutral-900 cursor-pointer font-medium"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        )}
      </div>

      {/* Connection Error Banner with Retry */}
      {connectionError && (
        <div className="p-4 rounded-xl text-xs bg-amber-50 border border-amber-200 text-amber-900 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-2">
            <WifiOff className="w-5 h-5 text-amber-600 shrink-0" />
            <div>
              <p className="font-bold">Backend Connection Issue</p>
              <p className="text-amber-700 text-[11px] mt-0.5">{connectionError}</p>
            </div>
          </div>
          <button
            onClick={() => loadInitial()}
            className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-lg cursor-pointer text-xs shrink-0 transition"
          >
            Retry Connection
          </button>
        </div>
      )}

      {/* Feedback Messages */}
      {feedback && (
        <div
          className={`p-3.5 rounded-xl text-xs flex items-center justify-between gap-3 ${
            feedback.type === 'error'
              ? 'bg-red-50 border border-red-200 text-red-700'
              : 'bg-emerald-50 border border-emerald-200 text-emerald-800'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedback.type === 'error' ? (
              <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
            ) : (
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
            )}
            <span>{feedback.text}</span>
          </div>
          <button onClick={() => setFeedback(null)} className="text-gray-500 hover:text-gray-800 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────── */}
      {/* SCREEN 1: 3-STEP TICKET CREATION FLOW                         */}
      {/* ───────────────────────────────────────────────────────────── */}
      {activeTab === 'create' && (
        <div className="bg-white border border-gray-200 rounded-2xl p-6 sm:p-8 shadow-xs space-y-6">
          <div className="border-b border-gray-100 pb-4">
            <h2 className="text-xl font-bold text-neutral-900">Get a Queue Ticket</h2>
            <p className="text-xs text-gray-500 mt-1">
              Select your office and service to receive your place in line.
            </p>
          </div>

          <form onSubmit={handleGetTicket} className="space-y-6">
            {/* Step 1: Select an Office */}
            <div className="space-y-2">
              <label htmlFor="select-office" className="block text-xs font-bold uppercase tracking-wider text-gray-700">
                Step 1: Select an Office
              </label>
              <select
                id="select-office"
                value={selectedOrgId}
                onChange={(e) => setSelectedOrgId(e.target.value)}
                className="w-full bg-white border border-gray-300 text-neutral-900 text-sm rounded-xl p-3 focus:outline-none focus:border-emerald-600 cursor-pointer"
              >
                {organizations.map((org) => (
                  <option key={org._id} value={org._id}>
                    {org.name}
                  </option>
                ))}
              </select>
              {selectedOrg && selectedOrg.address && (
                <p className="text-xs text-gray-500 flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5 text-gray-400" />
                  <span>{selectedOrg.address}</span>
                </p>
              )}
            </div>

            {/* Step 2: Select a Service */}
            <div className="space-y-2">
              <label htmlFor="select-service" className="block text-xs font-bold uppercase tracking-wider text-gray-700">
                Step 2: Select a Service / Department
              </label>
              <select
                id="select-service"
                value={selectedDeptId}
                onChange={(e) => setSelectedDeptId(e.target.value)}
                disabled={departments.length === 0}
                className="w-full bg-white border border-gray-300 text-neutral-900 text-sm rounded-xl p-3 focus:outline-none focus:border-emerald-600 cursor-pointer disabled:bg-gray-100"
              >
                {departments.length === 0 ? (
                  <option value="">No services available for this office</option>
                ) : (
                  departments.map((dept) => (
                    <option key={dept._id} value={dept._id}>
                      {dept.name} {dept.roomNumber ? `(Room ${dept.roomNumber})` : ''}
                    </option>
                  ))
                )}
              </select>
              <p className="text-xs text-gray-500">
                {selectedDept ? `Standard service desk for ${selectedDept.name}.` : 'Please pick an office first.'}
              </p>
            </div>

            {/* Priority selection - simple and unobtrusive */}
            <div className="space-y-2">
              <span className="block text-xs font-bold uppercase tracking-wider text-gray-700">
                Special Assistance (Optional)
              </span>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <button
                  type="button"
                  onClick={() => setPriority('NORMAL')}
                  className={`p-3 rounded-xl border text-left cursor-pointer transition ${
                    priority === 'NORMAL'
                      ? 'border-emerald-600 bg-emerald-50 text-emerald-900 font-semibold'
                      : 'border-gray-200 text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <div className="font-bold">Standard Queue</div>
                  <div className="text-gray-500 text-[11px] mt-0.5">Regular sequential turn</div>
                </button>

                <button
                  type="button"
                  onClick={() => setPriority('URGENT')}
                  className={`p-3 rounded-xl border text-left cursor-pointer transition ${
                    priority === 'URGENT'
                      ? 'border-emerald-600 bg-emerald-50 text-emerald-900 font-semibold'
                      : 'border-gray-200 text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <div className="font-bold">Senior / Specially Abled</div>
                  <div className="text-gray-500 text-[11px] mt-0.5">Priority assistance line</div>
                </button>
              </div>
            </div>

            {/* Step 3: Get Your Ticket Button */}
            <div className="pt-2">
              <button
                type="submit"
                disabled={isSubmitting || departments.length === 0}
                className="w-full py-3.5 px-4 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white text-sm font-bold rounded-xl transition cursor-pointer shadow-xs flex items-center justify-center gap-2"
              >
                {isSubmitting ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Issuing Your Ticket...</span>
                  </>
                ) : (
                  <span>Get My Ticket</span>
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────── */}
      {/* SCREEN 2: MY TICKET SCREEN (PROMINENT TICKET NUMBER & NEXT STEP)*/}
      {/* ───────────────────────────────────────────────────────────── */}
      {activeTab === 'ticket' && activeTicket && (
        <div className="space-y-6">
          {/* Main Clean Ticket Card */}
          <div className="bg-white border-2 border-gray-200 rounded-2xl p-6 sm:p-8 shadow-xs space-y-6 text-center">
            {/* Header */}
            <div className="space-y-1">
              <div className="text-xs font-bold tracking-widest text-gray-500 uppercase">
                QUEUELESS
              </div>
              <div className="text-xs text-gray-600 font-medium">Your Ticket</div>
            </div>

            {/* Prominent Ticket Number */}
            <div className="py-2">
              <div className="text-5xl sm:text-6xl font-black font-mono tracking-tight text-neutral-900">
                {activeTicket.ticketNumber}
              </div>
              <div className="mt-2">
                <span className="inline-block px-3 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-700">
                  {getStatusLabel(activeTicket.status)}
                </span>
              </div>
            </div>

            {/* Next Action Instruction Banner */}
            <div
              className={`p-4 rounded-xl text-xs sm:text-sm font-semibold transition ${
                activeTicket.status === 'CALLED'
                  ? 'bg-emerald-50 border-2 border-emerald-400 text-emerald-900 animate-pulse'
                  : 'bg-gray-50 border border-gray-200 text-neutral-800'
              }`}
            >
              {getNextInstruction(activeTicket.status)}
            </div>

            {/* Alert: Up Next Alert */}
            {activeTicket.status === 'WAITING' && peopleAhead <= 3 && peopleAhead > 0 && (
              <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-300 text-amber-900 text-xs font-semibold flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                <span>Get Ready! You are up next. Only {peopleAhead} {peopleAhead === 1 ? 'person is' : 'people are'} ahead of you.</span>
              </div>
            )}

            {/* Alert: Delayed Ticket / Snoozed Status */}
            {activeTicket.status === 'SNOOZED' && (
              <div className="p-3.5 rounded-xl bg-blue-50 border border-blue-300 text-blue-900 text-xs font-semibold flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-blue-600 shrink-0" />
                  <span>Ticket Delayed: Your turn has been paused temporarily and will be called back soon.</span>
                </div>
              </div>
            )}

            {/* People Ahead & Wait Time (Clear and Bold) */}
            <div className="grid grid-cols-2 gap-4 py-2 border-t border-b border-gray-100">
              <div className="text-center">
                <div className="text-2xl sm:text-3xl font-black text-neutral-900">
                  {activeTicket.status === 'CALLED' || activeTicket.status === 'SERVING'
                    ? 'Your Turn'
                    : activeTicket.status === 'COMPLETED'
                    ? '0'
                    : peopleAhead}
                </div>
                <div className="text-xs font-bold text-gray-700 mt-1">
                  {activeTicket.status === 'CALLED' || activeTicket.status === 'SERVING'
                    ? 'Proceed to counter'
                    : `${peopleAhead} people ahead of you`}
                </div>
              </div>

              <div className="text-center">
                <div className="text-2xl sm:text-3xl font-black text-neutral-900">
                  {activeTicket.status === 'CALLED' || activeTicket.status === 'SERVING' || activeTicket.status === 'COMPLETED'
                    ? '0 min'
                    : estimatedWaitMin !== null
                    ? `${estimatedWaitMin} min`
                    : '—'}
                </div>
                <div className="text-xs font-bold text-gray-700 mt-1">
                  {estimatedWaitMin !== null
                    ? `Estimated wait: ${estimatedWaitMin} minutes`
                    : 'Waiting time unavailable'}
                </div>
              </div>
            </div>

            {/* Office & Room Information (Only shown when actually assigned) */}
            <div className="text-xs text-gray-600 space-y-1">
              <div>
                Office: <strong className="text-neutral-900">{activeTicket.department?.name || 'Department Desk'}</strong>
              </div>
              {activeTicket.roomNumber && (
                <div>
                  Room: <strong className="text-neutral-900">{activeTicket.roomNumber}</strong>
                </div>
              )}
              {activeTicket.counter?.counterNumber && (
                <div>
                  Counter: <strong className="text-neutral-900">Counter {activeTicket.counter.counterNumber}</strong>
                </div>
              )}
            </div>

            {/* Delay Action for Citizens */}
            {activeTicket.status === 'WAITING' && (
              <div className="pt-2 flex justify-center border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => handleRequestDelay(5)}
                  disabled={delayLoading}
                  className="px-4 py-2 border border-gray-300 hover:border-gray-400 bg-white hover:bg-gray-50 text-gray-700 text-xs font-semibold rounded-xl transition cursor-pointer flex items-center gap-2 shadow-xs"
                >
                  {delayLoading ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Clock className="w-3.5 h-3.5 text-gray-500" />
                  )}
                  <span>Running Late? Request 5-Min Delay</span>
                </button>
              </div>
            )}
          </div>

          {/* ───────────────────────────────────────────────────────── */}
          {/* MULTI-DEPARTMENT JOURNEY TRACKER                          */}
          {/* ───────────────────────────────────────────────────────── */}
          {journeyData && journeyData.stages && journeyData.stages.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-4 shadow-xs">
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-700">
                Journey Progress
              </h3>

              <div className="space-y-3">
                {journeyData.stages.map((stage, idx) => {
                  const isDone = stage.status === 'COMPLETED';
                  const isCurrent = ['WAITING', 'CALLED', 'SERVING'].includes(stage.status);

                  return (
                    <div
                      key={idx}
                      className="flex items-start gap-3 p-3 rounded-xl border border-gray-100 bg-gray-50/50 text-xs"
                    >
                      <div
                        className={`w-6 h-6 rounded-full flex items-center justify-center font-bold text-xs shrink-0 ${
                          isDone
                            ? 'bg-emerald-700 text-white'
                            : isCurrent
                            ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                            : 'bg-gray-200 text-gray-600'
                        }`}
                      >
                        {isDone ? <Check className="w-3.5 h-3.5" /> : idx + 1}
                      </div>

                      <div className="flex-1">
                        <div className="font-bold text-neutral-900">
                          {stage.departmentName}
                          {stage.roomNumber && <span className="font-normal text-gray-500"> (Room {stage.roomNumber})</span>}
                        </div>
                        <div className="text-gray-500 text-[11px] mt-0.5">
                          Status: {getStatusLabel(stage.status)}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ───────────────────────────────────────────────────────── */}
          {/* TICKET HISTORY (VISUALLY SECONDARY AUDIT TRAIL)           */}
          {/* ───────────────────────────────────────────────────────── */}
          {eventHistory.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-3 shadow-xs">
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-700">
                Ticket Activity
              </h3>

              <div className="space-y-2 text-xs">
                {eventHistory.map((ev, i) => (
                  <div key={i} className="flex items-center justify-between text-gray-600 py-1 border-b border-gray-100 last:border-0">
                    <div>
                      <span className="font-semibold text-neutral-900">{ev.eventType.replace(/_/g, ' ')}</span>
                      {ev.departmentName && <span> • {ev.departmentName}</span>}
                    </div>
                    <span className="text-gray-400 font-mono text-[11px]">
                      {ev.timestamp ? new Date(ev.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Expandable Advanced Section for Recovery Token & Actions */}
          <div className="bg-gray-50 border border-gray-200 rounded-2xl p-4 text-xs space-y-3">
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="w-full flex items-center justify-between font-semibold text-gray-700 hover:text-neutral-900 cursor-pointer"
            >
              <span>Ticket Details & Mobile Recovery</span>
              {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>

            {showAdvanced && (
              <div className="space-y-3 pt-2 border-t border-gray-200">
                <div>
                  <label className="text-gray-500 block mb-1">Your Tracking Code:</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={activeTicket.trackingToken || ''}
                      className="flex-1 bg-white border border-gray-300 rounded-lg p-2 font-mono text-neutral-900 text-xs select-all"
                    />
                    <button
                      type="button"
                      onClick={copyToken}
                      className="px-3 py-2 bg-white border border-gray-300 rounded-lg font-semibold text-gray-700 hover:bg-gray-50 cursor-pointer flex items-center gap-1"
                    >
                      {copiedToken ? <Check className="w-3.5 h-3.5 text-emerald-700" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedToken ? 'Copied' : 'Copy'}</span>
                    </button>
                  </div>
                  <p className="text-[11px] text-gray-500 mt-1">
                    Keep this code to resume tracking if you close your browser.
                  </p>
                </div>

                <div className="pt-2 border-t border-gray-200 flex justify-end">
                  <button
                    type="button"
                    onClick={handleDismissTicket}
                    className="text-xs text-red-600 hover:text-red-700 font-semibold cursor-pointer"
                  >
                    Clear Ticket from Screen
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────── */}
      {/* SCREEN 3: LOOKUP EXISTING TICKET BY NUMBER OR TOKEN           */}
      {/* ───────────────────────────────────────────────────────────── */}
      {activeTab === 'track' && (
        <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-xs space-y-4">
          <h2 className="text-base font-bold text-neutral-900">Track an Existing Ticket</h2>
          <p className="text-xs text-gray-500">
            Enter your ticket number (e.g., REG-102) or 32-character recovery token to check your status.
          </p>

          <form onSubmit={handleLookup} className="space-y-4">
            <input
              type="text"
              value={lookupInput}
              onChange={(e) => setLookupInput(e.target.value)}
              placeholder="e.g. REG-102 or tracking code"
              className="w-full bg-white border border-gray-300 rounded-xl p-3 text-sm font-mono text-neutral-900 focus:outline-none focus:border-emerald-600"
            />

            <button
              type="submit"
              disabled={lookupLoading || !lookupInput.trim()}
              className="w-full py-3 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white font-bold text-xs rounded-xl transition cursor-pointer flex items-center justify-center gap-2"
            >
              {lookupLoading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Looking up...</span>
                </>
              ) : (
                <>
                  <Search className="w-4 h-4" />
                  <span>Track Ticket</span>
                </>
              )}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}