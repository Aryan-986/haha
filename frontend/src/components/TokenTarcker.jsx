import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { playNotificationChime } from '../utils/alertSound';

const API_BASE = 'http://localhost:5000/api';

export default function TokenTracker({ serviceId }) {
  const [tokenInput, setTokenInput] = useState('');
  const [trackedToken, setTrackedToken] = useState(null);
  const [queueInfo, setQueueInfo] = useState({ nowServing: 'A-100', waitingCount: 0 });
  const [alertFired, setAlertFired] = useState(false);

  const fetchStatus = async () => {
    if (!serviceId) return;
    try {
      const res = await axios.get(`${API_BASE}/queue/${serviceId}`);
      setQueueInfo(res.data);
    } catch (err) {
      console.error('Queue sync error:', err);
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 2000);
    return () => clearInterval(interval);
  }, [serviceId]);

  const parseNum = (str) => {
    const m = str?.match(/\d+/);
    return m ? parseInt(m[0], 10) : 0;
  };

  const servingNum = parseNum(queueInfo.nowServing);
  const myNum = parseNum(trackedToken);
  const peopleAhead = Math.max(0, myNum - servingNum);
  const estWaitMins = peopleAhead * 3; // ~3 mins per turn

  // Audio alert trigger on <= 5 people remaining
  useEffect(() => {
    if (trackedToken && peopleAhead <= 5 && peopleAhead >= 0 && !alertFired) {
      playNotificationChime();
      setAlertFired(true);
    }
  }, [peopleAhead, trackedToken, alertFired]);

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 shadow-xl space-y-6">
      <div className="border-b border-slate-700 pb-4">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <span>🎫</span> Citizen Personal Token Tracker
        </h2>
        <p className="text-xs text-slate-400 mt-1">
          Enter the token number printed from the physical ticket dispenser machine.
        </p>
      </div>

      {/* Input Form */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setTrackedToken(tokenInput.toUpperCase());
          setAlertFired(false);
        }}
        className="flex gap-2"
      >
        <input
          type="text"
          placeholder="Enter Token (e.g. A-105)"
          value={tokenInput}
          onChange={(e) => setTokenInput(e.target.value)}
          className="flex-1 bg-slate-900 border border-slate-700 px-4 py-2.5 rounded-xl text-white font-mono uppercase focus:outline-none focus:border-indigo-500"
        />
        <button
          type="submit"
          className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-xl transition"
        >
          Track My Turn
        </button>
      </form>

      {/* Real-time Status Card */}
      {trackedToken && (
        <div className="bg-slate-900/80 rounded-xl p-5 border border-slate-700/80 space-y-4">
          <div className="flex justify-between items-center border-b border-slate-800 pb-3">
            <div>
              <span className="text-xs text-slate-400 uppercase font-bold">Your Token</span>
              <p className="text-2xl font-black text-indigo-400 font-mono">{trackedToken}</p>
            </div>
            <div className="text-right">
              <span className="text-xs text-slate-400 uppercase font-bold">Now Serving</span>
              <p className="text-2xl font-black text-emerald-400 font-mono">{queueInfo.nowServing}</p>
            </div>
          </div>

          {peopleAhead === 0 ? (
            <div className="bg-emerald-500/20 border border-emerald-500 text-emerald-300 p-4 rounded-xl text-center font-bold text-lg animate-pulse">
              🎉 YOUR TURN! Please proceed to Counter immediately.
            </div>
          ) : peopleAhead <= 5 ? (
            <div className="bg-amber-500/20 border border-amber-500 text-amber-300 p-4 rounded-xl text-center font-bold">
              🔔 ALERT: Only {peopleAhead} citizens left before your turn! (~{estWaitMins} mins)
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 text-center">
              <div className="bg-slate-800 p-3 rounded-lg border border-slate-700">
                <span className="text-xs text-slate-400">People Remaining Ahead</span>
                <p className="text-xl font-bold text-slate-100">{peopleAhead} Citizens</p>
              </div>
              <div className="bg-slate-800 p-3 rounded-lg border border-slate-700">
                <span className="text-xs text-slate-400">Approx. Wait Time</span>
                <p className="text-xl font-bold text-indigo-300">~{estWaitMins} Mins</p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}