import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import axios from 'axios';
import { 
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer 
} from 'recharts';
import { 
  Clock, Users, AlertCircle, CheckCircle2, Search, ArrowLeft, RefreshCw, 
  Sparkles, Bell, Trash2, Volume2, VolumeX, Plus, BellOff, Check, UserCheck, FastForward 
} from 'lucide-react';

const API_BASE = 'http://localhost:5000/api';
const LOCAL_STORAGE_KEY = 'queueless_active_token';
const ALARMS_STORAGE_KEY = 'queueless_custom_alarms';

const TicketTracker = ({ onBack }) => {
  const [tokenInput, setTokenInput] = useState('');
  const [activeToken, setActiveToken] = useState(() => {
    try {
      const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const [service, setService] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  
  // Tracking user check-in or delayed state
  const [isCheckInConfirmed, setIsCheckInConfirmed] = useState(false);
  const [delayCount, setDelayCount] = useState(0);

  // Dynamic Alarms State (Defaults + User-defined)
  const [customAlarms, setCustomAlarms] = useState(() => {
    try {
      const saved = localStorage.getItem(ALARMS_STORAGE_KEY);
      return saved ? JSON.parse(saved) : [
        { id: 'def-15', minute: 15, enabled: true, isDefault: true },
        { id: 'def-10', minute: 10, enabled: true, isDefault: true },
        { id: 'def-5', minute: 5, enabled: true, isDefault: true },
        { id: 'def-2', minute: 2, enabled: true, isDefault: true },
      ];
    } catch {
      return [
        { id: 'def-15', minute: 15, enabled: true, isDefault: true },
        { id: 'def-10', minute: 10, enabled: true, isDefault: true },
        { id: 'def-5', minute: 5, enabled: true, isDefault: true },
        { id: 'def-2', minute: 2, enabled: true, isDefault: true },
      ];
    }
  });
  const [newAlarmInput, setNewAlarmInput] = useState('');

  // Alarm & Audio State Tracking
  const [isRinging, setIsRinging] = useState(false);
  const [activeAlarmMinute, setActiveAlarmMinute] = useState(null);
  
  const audioCtxRef = useRef(null);
  const ringIntervalRef = useRef(null);
  const activeNodesRef = useRef([]);
  const isPlayingRef = useRef(false);
  const notifiedThresholdsRef = useRef(new Set());

  // Save Custom Alarms to LocalStorage
  useEffect(() => {
    try {
      localStorage.setItem(ALARMS_STORAGE_KEY, JSON.stringify(customAlarms));
    } catch (err) {
      console.error('Failed to save alarms to localStorage:', err);
    }
  }, [customAlarms]);

  // Request browser notification permissions on mount
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  // Stop Ringtone Audio Completely
  const stopRingtone = useCallback(() => {
    isPlayingRef.current = false;
    setIsRinging(false);

    if (ringIntervalRef.current) {
      clearInterval(ringIntervalRef.current);
      ringIntervalRef.current = null;
    }

    if (activeNodesRef.current.length > 0) {
      activeNodesRef.current.forEach(node => {
        try {
          node.stop();
          node.disconnect();
        } catch {
          // Ignore nodes already stopped or disconnected
        }
      });
      activeNodesRef.current = [];
    }

    if (audioCtxRef.current) {
      try {
        if (audioCtxRef.current.state !== 'closed') {
          audioCtxRef.current.close();
        }
      } catch (e) {
        console.warn('AudioContext close error:', e);
      }
      audioCtxRef.current = null;
    }
  }, []);

  // Save/remove activeToken in localStorage & cleanup audio on unmount
  useEffect(() => {
    if (activeToken) {
      try {
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(activeToken));
      } catch (e) {
        console.error('Failed to set token in localStorage:', e);
      }
    } else {
      localStorage.removeItem(LOCAL_STORAGE_KEY);
      stopRingtone();
      notifiedThresholdsRef.current.clear();
      setIsCheckInConfirmed(false);
      setDelayCount(0);
    }

    return () => {
      stopRingtone();
    };
  }, [activeToken, stopRingtone]);

  // Melodic Alarm Ringtone Synthesizer
  const startRingtone = useCallback((minuteMark) => {
    if (isPlayingRef.current) return;
    
    isPlayingRef.current = true;
    setIsRinging(true);
    setActiveAlarmMinute(minuteMark);

    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtx();
      audioCtxRef.current = ctx;

      if (ctx.state === 'suspended') {
        ctx.resume();
      }

      const playMelodyBurst = () => {
        if (!isPlayingRef.current || !audioCtxRef.current || ctx.state === 'closed') return;

        const notes = [659.25, 830.61, 987.77, 1318.51];
        
        notes.forEach((freq, idx) => {
          if (!isPlayingRef.current) return;

          const osc = ctx.createOscillator();
          const gain = ctx.createGain();

          osc.type = 'triangle';
          osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.18);

          gain.gain.setValueAtTime(0.2, ctx.currentTime + idx * 0.18);
          gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + idx * 0.18 + 0.35);

          osc.connect(gain);
          gain.connect(ctx.destination);

          osc.start(ctx.currentTime + idx * 0.18);
          osc.stop(ctx.currentTime + idx * 0.18 + 0.35);

          activeNodesRef.current.push(osc);
        });
      };

      playMelodyBurst();
      ringIntervalRef.current = setInterval(playMelodyBurst, 1500);

    } catch (e) {
      console.warn('Web Audio Playback Error:', e);
    }
  }, []);

  // Fetch queue data from backend API
  const fetchLiveData = useCallback(async (isMounted) => {
    try {
      const res = await axios.get(`${API_BASE}/services`);
      if (isMounted && res.data && res.data.length > 0) {
        const raw = res.data[0];

        const extractedServing = Number(
          raw.currentlyServingNumber ?? raw.nowServing ?? raw.currentServing ?? 100
        );
        const extractedQueueCount = Number(
          raw.currentQueueCount ?? raw.remainingWaiting ?? raw.totalWaiting ?? 0
        );
        const extractedCounters = Number(
          raw.activeCounters ?? raw.openCounters ?? 10
        );

        setService({
          ...raw,
          currentlyServingNumber: isNaN(extractedServing) ? 100 : extractedServing,
          currentQueueCount: isNaN(extractedQueueCount) ? 0 : extractedQueueCount,
          activeCounters: isNaN(extractedCounters) ? 10 : extractedCounters
        });
      }
    } catch (err) {
      console.error('Error fetching live queue:', err);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;

    fetchLiveData(isMounted);
    const interval = setInterval(() => {
      fetchLiveData(isMounted);
    }, 2000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [fetchLiveData]);

  const handleAnalyzeToken = (e) => {
    e.preventDefault();
    if (!tokenInput.trim()) return;

    setError(null);
    setLoading(true);

    const parsedNumber = parseInt(tokenInput.replace(/\D/g, ''), 10);

    if (isNaN(parsedNumber)) {
      setError('Please enter a valid token number (e.g., A-234 or 234)');
      setLoading(false);
      return;
    }

    setTimeout(() => {
      setActiveToken({
        raw: tokenInput.trim().toUpperCase(),
        number: parsedNumber
      });
      setLoading(false);
    }, 300);
  };

  // Queue Calculations (Adjusted for dynamic token delay)
  const currentServingNum = Number(service?.currentlyServingNumber ?? 100);
  const activeCounters = Math.max(1, Number(service?.activeCounters ?? 10));
  
  // Each delay request dynamically pushes token 5 positions back
  const pushedOffset = delayCount * 5;
  const rawPeopleAhead = activeToken 
    ? Math.max(0, Number(activeToken.number) - currentServingNum) 
    : 0;
  const peopleAhead = rawPeopleAhead + pushedOffset;

  const avgMinsPerPerson = 3; 
  const estimatedWaitMinutes = Math.max(0, Math.ceil((peopleAhead * avgMinsPerPerson) / activeCounters));
  const isUserTurnNext = peopleAhead <= 3 && peopleAhead > 0;
  const isUserTurnNow = peopleAhead === 0 && activeToken;

  // Handle Delay Action
  const handleRequestDelay = () => {
    stopRingtone();
    setDelayCount(prev => prev + 1);
    setIsCheckInConfirmed(false);
    notifiedThresholdsRef.current.clear(); // Reset alarms to trigger again for new wait time
  };

  // Handle Presence Check-in Action
  const handleConfirmPresence = () => {
    stopRingtone();
    setIsCheckInConfirmed(true);
  };

  // Add Dynamic Custom Alarm Threshold
  const handleAddCustomAlarm = (e) => {
    e.preventDefault();
    const minVal = parseInt(newAlarmInput, 10);

    if (isNaN(minVal) || minVal <= 0) return;

    if (customAlarms.some(a => a.minute === minVal)) {
      setNewAlarmInput('');
      return;
    }

    const newAlarm = {
      id: `custom-${Date.now()}`,
      minute: minVal,
      enabled: true,
      isDefault: false
    };

    setCustomAlarms(prev => [...prev, newAlarm].sort((a, b) => b.minute - a.minute));
    setNewAlarmInput('');
  };

  // Toggle Alarm On/Off
  const handleToggleAlarm = (id) => {
    setCustomAlarms(prev => prev.map(alarm => 
      alarm.id === id ? { ...alarm, enabled: !alarm.enabled } : alarm
    ));
  };

  // Delete Alarm
  const handleDeleteAlarm = (id) => {
    setCustomAlarms(prev => prev.filter(alarm => alarm.id !== id));
  };

  // Dynamic Trigger Logic
  useEffect(() => {
    if (!activeToken) return;

    const activeEnabledThresholds = customAlarms
      .filter(a => a.enabled)
      .map(a => a.minute)
      .sort((a, b) => b - a);
    
    for (const target of activeEnabledThresholds) {
      if (
        estimatedWaitMinutes <= target && 
        estimatedWaitMinutes > 0 && 
        !notifiedThresholdsRef.current.has(target)
      ) {
        notifiedThresholdsRef.current.add(target);
        startRingtone(target);

        if ('Notification' in window && Notification.permission === 'granted') {
          try {
            new Notification(`Queue Alert (${target} Mins Left)! ⌛`, {
              body: `Token ${activeToken.raw}: ~${estimatedWaitMinutes} mins remaining! Please approach your counter soon.`,
              icon: '/favicon.ico'
            });
          } catch (e) {
            console.warn('Desktop notification dispatch error:', e);
          }
        }
        break;
      }
    }
  }, [estimatedWaitMinutes, activeToken, customAlarms, startRingtone]);

  const handleClearToken = () => {
    stopRingtone();
    setActiveToken(null);
    setTokenInput('');
  };

  // Recharts Data Setup
  const chartData = useMemo(() => {
    if (!peopleAhead || estimatedWaitMinutes <= 0) return [];
    
    const points = [];
    const stepMinutes = Math.max(1, Math.ceil(estimatedWaitMinutes / 5));
    
    for (let min = 0; min <= estimatedWaitMinutes; min += stepMinutes) {
      const remainingPeople = Math.max(0, Math.round(peopleAhead - (min * activeCounters / avgMinsPerPerson)));
      points.push({
        time: `+${min}m`,
        peopleAhead: remainingPeople,
        estimatedWait: Math.max(0, Math.ceil((remainingPeople * avgMinsPerPerson) / activeCounters))
      });
    }
    return points;
  }, [peopleAhead, estimatedWaitMinutes, activeCounters]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 sm:p-6 lg:p-8 font-sans">
      <div className="max-w-4xl mx-auto space-y-6">
        
        {/* Top Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center space-x-3">
            {onBack && (
              <button 
                onClick={onBack} 
                className="p-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-white transition"
              >
                <ArrowLeft size={18} />
              </button>
            )}
            <div>
              <h1 className="text-xl font-bold text-white tracking-wide flex items-center gap-2">
                Live Token Analyzer
                <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              </h1>
              <p className="text-xs text-slate-400">
                {service?.office || 'District Administration Office (DAO), Kathmandu'}
              </p>
            </div>
          </div>

          <div className="text-right">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">Total Waiting</span>
            <span className="text-lg font-bold text-indigo-400">{service?.currentQueueCount ?? 0} People</span>
          </div>
        </div>

        {/* Ringing Alarm Banner */}
        {isRinging && (
          <div className="bg-rose-500/20 border-2 border-rose-500 p-4 rounded-2xl flex items-center justify-between animate-pulse shadow-lg shadow-rose-500/20">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-rose-500 text-white rounded-xl animate-bounce">
                <Volume2 size={24} />
              </div>
              <div>
                <h4 className="font-extrabold text-white text-base">
                  Incoming Queue Alert ({activeAlarmMinute} Mins Remaining)!
                </h4>
                <p className="text-xs text-rose-200">
                  Your token {activeToken?.raw} is near its turn.
                </p>
              </div>
            </div>
            <button
              onClick={stopRingtone}
              className="px-5 py-2.5 bg-rose-600 hover:bg-rose-500 text-white text-sm font-bold rounded-xl flex items-center gap-2 transition shadow-md"
            >
              <VolumeX size={18} />
              Stop Alarm
            </button>
          </div>
        )}

        {/* Form Input */}
        {!activeToken && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 text-center space-y-6 shadow-2xl">
            <div className="max-w-md mx-auto space-y-2">
              <div className="w-12 h-12 bg-indigo-500/10 border border-indigo-500/30 rounded-xl flex items-center justify-center mx-auto text-indigo-400 mb-4">
                <Sparkles size={24} />
              </div>
              <h2 className="text-2xl font-bold text-white">Track Your Queue Turn</h2>
              <p className="text-sm text-slate-400">
                Enter your ticket number to trigger custom alarms and live desktop notifications.
              </p>
            </div>

            <form onSubmit={handleAnalyzeToken} className="max-w-md mx-auto space-y-4">
              <div className="relative">
                <input
                  type="text"
                  placeholder="e.g. A-234 or 234"
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-xl px-4 py-3.5 text-center text-xl font-mono font-bold tracking-wider text-white outline-none transition"
                />
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full mt-3 py-3.5 px-6 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-xl transition shadow-lg shadow-indigo-600/30 flex items-center justify-center gap-2"
                >
                  {loading ? <RefreshCw className="animate-spin" size={18} /> : <><Search size={18} /> Analyze My Turn</>}
                </button>
              </div>
              {error && <p className="text-xs text-rose-400">{error}</p>}
            </form>
          </div>
        )}

        {/* Active Analysis Dashboard */}
        {activeToken && (
          <div className="space-y-6">
            
            {/* Token & Status Banner */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 relative overflow-hidden">
              <div className="flex flex-col md:flex-row items-center justify-between gap-6">
                
                <div className="flex items-center space-x-4">
                  <div className="bg-indigo-600/20 border border-indigo-500/40 p-4 rounded-2xl text-center min-w-[110px]">
                    <span className="text-[10px] uppercase font-semibold text-indigo-300 block">Your Token</span>
                    <span className="text-3xl font-black font-mono text-indigo-400">{activeToken.raw}</span>
                  </div>
                  <div>
                    <span className="text-xs font-medium text-slate-400 block uppercase">Currently Serving</span>
                    <span className="text-2xl font-bold font-mono text-white">A-{currentServingNum}</span>
                    <p className="text-xs text-slate-400 mt-1">
                      Active Counters: <span className="text-slate-200 font-bold">{activeCounters}</span>
                    </p>
                  </div>
                </div>

                {/* Arrival & Delay Presence Controls */}
                <div className="flex flex-col items-center md:items-end gap-3 w-full md:w-auto">
                  
                  {/* Interactive Delay / On Time Buttons */}
                  <div className="flex flex-wrap items-center justify-center md:justify-end gap-2 w-full">
                    {!isCheckInConfirmed ? (
                      <button
                        onClick={handleConfirmPresence}
                        className="flex-1 md:flex-none px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 transition shadow-md"
                      >
                        <UserCheck size={16} />
                        I Am Here On Time
                      </button>
                    ) : (
                      <div className="flex items-center gap-1.5 px-3 py-2 bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 text-xs font-semibold rounded-xl">
                        <CheckCircle2 size={16} /> Arrived & Checked In
                      </div>
                    )}

                    <button
                      onClick={handleRequestDelay}
                      className="flex-1 md:flex-none px-4 py-2 bg-amber-600/20 hover:bg-amber-600/30 border border-amber-500/40 text-amber-300 text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 transition"
                    >
                      <FastForward size={16} />
                      I Am Delayed / Request Delay
                    </button>
                  </div>

                  {delayCount > 0 && (
                    <span className="text-[11px] text-amber-400/90 bg-amber-950/40 border border-amber-800/50 px-2.5 py-1 rounded-lg">
                      Pushed back +{pushedOffset} positions ({delayCount}x delay requested)
                    </span>
                  )}

                  <div className="flex items-center gap-3 mt-1">
                    {isUserTurnNow ? (
                      <div className="inline-flex items-center gap-2 bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 px-3 py-1 rounded-xl text-xs font-bold animate-bounce">
                        <CheckCircle2 size={14} /> Proceed to Counter
                      </div>
                    ) : isUserTurnNext ? (
                      <div className="inline-flex items-center gap-2 bg-amber-500/20 border border-amber-500/40 text-amber-400 px-3 py-1 rounded-xl text-xs font-bold">
                        <AlertCircle size={14} /> Get Ready! You are up next
                      </div>
                    ) : (
                      <div className="inline-flex items-center gap-2 bg-indigo-500/10 border border-indigo-500/30 text-indigo-300 px-3 py-1 rounded-xl text-xs font-semibold">
                        <Bell size={14} className="text-indigo-400" /> Auto-Alarms Monitoring Live Wait
                      </div>
                    )}

                    <button
                      onClick={handleClearToken}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-400 text-xs font-medium transition"
                    >
                      <Trash2 size={13} /> Delete
                    </button>
                  </div>

                </div>

              </div>
            </div>

            {/* Dynamic Alarm Manager Control Panel */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <Bell size={18} className="text-indigo-400" /> Dynamic Queue Alarm Manager
                  </h3>
                  <p className="text-xs text-slate-400">Set custom minute thresholds to ring an alarm before your turn.</p>
                </div>

                <form onSubmit={handleAddCustomAlarm} className="flex items-center gap-2">
                  <div className="relative">
                    <input
                      type="number"
                      min="1"
                      max="180"
                      placeholder="Mins (e.g. 20)"
                      value={newAlarmInput}
                      onChange={(e) => setNewAlarmInput(e.target.value)}
                      className="w-32 bg-slate-950 border border-slate-700 focus:border-indigo-500 rounded-xl px-3 py-2 text-xs text-white outline-none"
                    />
                    <span className="absolute right-3 top-2 text-[10px] text-slate-500 font-bold uppercase">m</span>
                  </div>
                  <button
                    type="submit"
                    className="px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold flex items-center gap-1 transition shadow-md"
                  >
                    <Plus size={14} /> Add Alarm
                  </button>
                </form>
              </div>

              <div className="flex flex-wrap gap-2.5 pt-2">
                {customAlarms.map((alarm) => (
                  <div 
                    key={alarm.id}
                    className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-mono font-medium transition ${
                      alarm.enabled 
                        ? 'bg-indigo-950/40 border-indigo-500/50 text-indigo-200' 
                        : 'bg-slate-950/60 border-slate-800 text-slate-500 line-through'
                    }`}
                  >
                    <button 
                      onClick={() => handleToggleAlarm(alarm.id)}
                      className={`p-1 rounded-md transition ${alarm.enabled ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400'}`}
                      title={alarm.enabled ? 'Disable Alarm' : 'Enable Alarm'}
                    >
                      {alarm.enabled ? <Check size={12} /> : <BellOff size={12} />}
                    </button>
                    <span>{alarm.minute} Mins Before</span>

                    {!alarm.isDefault && (
                      <button 
                        onClick={() => handleDeleteAlarm(alarm.id)}
                        className="text-slate-500 hover:text-rose-400 ml-1 p-0.5 rounded transition"
                        title="Delete Alarm"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Metrics Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-slate-900/80 border border-slate-800 p-5 rounded-2xl space-y-1">
                <div className="flex items-center justify-between text-slate-400">
                  <span className="text-xs font-semibold uppercase">People Ahead</span>
                  <Users size={16} className="text-indigo-400" />
                </div>
                <div className="text-3xl font-bold text-white font-mono">{peopleAhead}</div>
                <p className="text-xs text-slate-500">
                  {pushedOffset > 0 ? `Includes +${pushedOffset} delay shift` : 'In queue before your token'}
                </p>
              </div>

              <div className="bg-slate-900/80 border border-slate-800 p-5 rounded-2xl space-y-1">
                <div className="flex items-center justify-between text-slate-400">
                  <span className="text-xs font-semibold uppercase">Estimated Wait</span>
                  <Clock size={16} className="text-emerald-400" />
                </div>
                <div className="text-3xl font-bold text-emerald-400 font-mono">{estimatedWaitMinutes} <span className="text-sm">mins</span></div>
                <p className="text-xs text-slate-500">Based on ~{avgMinsPerPerson}m per counter step</p>
              </div>

              <div className="bg-slate-900/80 border border-slate-800 p-5 rounded-2xl space-y-1">
                <div className="flex items-center justify-between text-slate-400">
                  <span className="text-xs font-semibold uppercase">Queue Status</span>
                  <Sparkles size={16} className="text-amber-400" />
                </div>
                <div className="text-lg font-bold text-slate-200 pt-1">
                  {service?.crowdLevel || 'LOW CROWD'}
                </div>
                <p className="text-xs text-slate-500">Live system load indicator</p>
              </div>
            </div>

            {/* Timeline Chart */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-white">Turn Estimation Timeline</h3>
                  <p className="text-xs text-slate-400">Projected queue reduction rate for Token #{activeToken.raw}</p>
                </div>
              </div>

              <div className="h-64 w-full pt-4">
                {peopleAhead > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData}>
                      <defs>
                        <linearGradient id="queueColor" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#6366f1" stopOpacity={0.4}/>
                          <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="time" stroke="#64748b" fontSize={12} tickLine={false} />
                      <YAxis stroke="#64748b" fontSize={12} tickLine={false} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '12px' }}
                      />
                      <Area 
                        type="monotone" 
                        dataKey="peopleAhead" 
                        stroke="#6366f1" 
                        strokeWidth={3} 
                        fillOpacity={1} 
                        fill="url(#queueColor)" 
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-slate-500 text-sm border border-dashed border-slate-800 rounded-xl space-y-3">
                    <CheckCircle2 size={36} className="text-emerald-500 animate-bounce" />
                    <span>You are at the head of the queue!</span>
                    <button
                      onClick={handleClearToken}
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-medium text-xs shadow-lg transition"
                    >
                      Clear Token Session
                    </button>
                  </div>
                )}
              </div>
            </div>

          </div>
        )}

      </div>
    </div>
  );
};

export default TicketTracker;