import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';

const API_BASE = 'http://localhost:5000/api';

const KioskHardwareSimulator = ({ serviceId, onDispense }) => {
  const [loading, setLoading] = useState(false);
  const [isAutoLoop, setIsAutoLoop] = useState(false);
  const [intervalMinutes, setIntervalMinutes] = useState(1);
  const [lastDispensedTicket, setLastDispensedTicket] = useState(null);
  const [error, setError] = useState(null);

  // Store interval ID in a ref so it persists across renders
  const loopRef = useRef(null);

  // Function to dispense a single token
  const dispenseToken = async () => {
    setLoading(true);
    try {
      const res = await axios.post(`${API_BASE}/kiosk/dispense-token`, { serviceId });
      setLastDispensedTicket(res.data?.ticket?.ticketNumber || 'Dispensed');
      setError(null);
      if (onDispense) onDispense();
    } catch (err) {
      console.error('Kiosk simulation error:', err);
      setError('Failed to dispense token from hardware');
    } finally {
      setLoading(false);
    }
  };

  // Start / Stop auto token loop
  const toggleAutoLoop = () => {
    if (isAutoLoop) {
      // Stop looping
      clearInterval(loopRef.current);
      loopRef.current = null;
      setIsAutoLoop(false);
    } else {
      // Dispense immediately once on click
      dispenseToken();

      // Set interval for recurring tokens (intervalMinutes * 60 * 1000 ms)
      const ms = Math.max(0.1, intervalMinutes) * 60 * 1000;
      loopRef.current = setInterval(() => {
        dispenseToken();
      }, ms);

      setIsAutoLoop(true);
    }
  };

  // Cleanup interval if component unmounts
  useEffect(() => {
    return () => {
      if (loopRef.current) clearInterval(loopRef.current);
    };
  }, []);

  return (
    <div className="bg-slate-800 p-5 rounded-xl border border-indigo-500/30 shadow-lg space-y-4">
      <div className="flex items-center justify-between border-b border-slate-700 pb-3">
        <div className="flex items-center space-x-2">
          <span className="relative flex h-3 w-3">
            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${isAutoLoop ? 'bg-emerald-400' : 'bg-indigo-400'}`}></span>
            <span className={`relative inline-flex rounded-full h-3 w-3 ${isAutoLoop ? 'bg-emerald-500' : 'bg-indigo-500'}`}></span>
          </span>
          <h3 className="text-sm font-semibold text-slate-200 tracking-wide uppercase">
            Physical Kiosk Hardware Simulator
          </h3>
        </div>
        {isAutoLoop && (
          <span className="text-xs bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded font-mono animate-pulse">
            LIVE LOOP ACTIVE
          </span>
        )}
      </div>

      {error && (
        <div className="text-xs bg-red-500/10 border border-red-500/30 text-red-400 p-2 rounded">
          {error}
        </div>
      )}

      {/* Control Actions */}
      <div className="space-y-3">
        <div className="flex items-center space-x-3">
          {/* Manual Single Press */}
          <button
            onClick={dispenseToken}
            disabled={loading}
            className="flex-1 py-2 px-3 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 text-white font-medium text-xs rounded transition duration-150"
          >
            {loading ? 'Dispensing...' : '🔘 Single Press (1 Token)'}
          </button>

          {/* Auto Loop Toggle Button */}
          <button
            onClick={toggleAutoLoop}
            className={`flex-1 py-2 px-3 font-semibold text-xs rounded transition duration-150 shadow-md ${
              isAutoLoop
                ? 'bg-rose-600 hover:bg-rose-500 text-white border border-rose-400'
                : 'bg-emerald-600 hover:bg-emerald-500 text-white'
            }`}
          >
            {isAutoLoop ? '⏹ Stop Auto Dispenser' : '▶ Start Auto Dispenser'}
          </button>
        </div>

        {/* Interval Settings */}
        <div className="flex items-center justify-between bg-slate-900/60 p-2.5 rounded border border-slate-700/50 text-xs text-slate-300">
          <label htmlFor="interval-input" className="font-medium">Dispense Interval (Minutes):</label>
          <input
            id="interval-input"
            type="number"
            min="0.1"
            step="0.1"
            disabled={isAutoLoop}
            value={intervalMinutes}
            onChange={(e) => setIntervalMinutes(parseFloat(e.target.value) || 1)}
            className="w-16 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-center font-mono text-white focus:outline-none focus:border-indigo-500 disabled:opacity-50"
          />
        </div>
      </div>

      {/* Output Status */}
      {lastDispensedTicket && (
        <div className="text-center bg-slate-900/40 p-2 rounded border border-slate-700/30">
          <span className="text-xs text-slate-400">Last Hardware Ticket Printed: </span>
          <span className="text-xs font-bold font-mono text-emerald-400">{lastDispensedTicket}</span>
        </div>
      )}
    </div>
  );
};

export default KioskHardwareSimulator;