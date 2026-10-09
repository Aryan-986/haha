import React, { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import { Play, Square, Plus, RefreshCw, AlertCircle, CheckCircle2, Cpu } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api/v1';

export default function KioskHardwareSimulator({ orgId, deptId, onDispense }) {
  // Only show simulator in development mode
  const isDev = import.meta.env.DEV || process.env.NODE_ENV !== 'production';

  const [intervalSec, setIntervalSec] = useState(10); // Default 10 seconds per instructions
  const [isRunning, setIsRunning] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [sessionCount, setSessionCount] = useState(0);
  const [lastTicket, setLastTicket] = useState(null);
  const [lastError, setLastError] = useState(null);

  // Timer reference to prevent duplicate loops
  const timerRef = useRef(null);
  const isRunningRef = useRef(false);
  isRunningRef.current = isRunning;
  const isProcessingRef = useRef(false);
  isProcessingRef.current = isProcessing;

  // Single ticket dispense function
  const dispenseOne = useCallback(async () => {
    if (!orgId || !deptId) {
      setLastError('Please select an active organization and department first.');
      return false;
    }

    try {
      setIsProcessing(true);
      setLastError(null);

      const res = await axios.post(`${API_BASE}/tokens/dispense`, {
        orgId,
        deptId,
        source: 'KIOSK',
        priority: 'NORMAL'
      });

      const ticketNum = res.data?.ticketNumber || res.data?.ticket?.ticketNumber;
      if (ticketNum) {
        setLastTicket(ticketNum);
        setSessionCount((prev) => prev + 1);
        if (onDispense) onDispense();
        return true;
      }
      return false;
    } catch (err) {
      console.error('Simulator error:', err);
      const errMsg = err.response?.data?.error || err.message || 'Failed to dispense simulated ticket';
      setLastError(errMsg);
      return false;
    } finally {
      setIsProcessing(false);
    }
  }, [orgId, deptId, onDispense]);

  // Controlled recursive timer loop to avoid overlapping calls or memory leaks
  const scheduleNext = useCallback(() => {
    if (!isRunningRef.current) return;

    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    const delayMs = Math.max(3, Math.min(30, intervalSec)) * 1000;

    timerRef.current = setTimeout(async () => {
      if (!isRunningRef.current) return;
      if (!isProcessingRef.current) {
        await dispenseOne();
      }
      if (isRunningRef.current) {
        scheduleNext();
      }
    }, delayMs);
  }, [intervalSec, dispenseOne]);

  // Start simulation loop
  const handleStart = async () => {
    if (isRunning) return; // Prevent duplicate loops
    if (!orgId || !deptId) {
      setLastError('Please select an organization and department before starting simulation.');
      return;
    }

    setLastError(null);
    setIsRunning(true);
    isRunningRef.current = true;

    // Trigger first generation immediately
    await dispenseOne();

    // Schedule subsequent ticks
    scheduleNext();
  };

  // Stop simulation loop
  const handleStop = () => {
    setIsRunning(false);
    isRunningRef.current = false;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  // Safe cleanup when component unmounts or orgId/deptId changes
  useEffect(() => {
    return () => {
      handleStop();
    };
  }, []);

  // Stop simulation when target department changes to avoid leaking tickets to previous department
  useEffect(() => {
    if (isRunning) {
      handleStop();
      setLastError('Simulation stopped because department or organization changed.');
    }
  }, [orgId, deptId]);

  if (!isDev) {
    return null;
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-xs space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 pb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center text-gray-700">
            <Cpu className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-neutral-900">
              Development Tools — Kiosk Simulator
            </h3>
            <p className="text-xs text-gray-500">
              Simulates walk-in ticket dispensing for dev testing (ESP32 + Thermal Printer behavior).
            </p>
          </div>
        </div>

        <div>
          {isRunning ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
              <span className="w-2 h-2 rounded-full bg-emerald-600 animate-ping" />
              Simulating every {intervalSec}s
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
              <span className="w-2 h-2 rounded-full bg-gray-400" />
              Simulator Idle
            </span>
          )}
        </div>
      </div>

      {/* Error alert */}
      {lastError && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
          <span>{lastError}</span>
        </div>
      )}

      {/* Controls */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* Single Press Button */}
        <button
          type="button"
          onClick={dispenseOne}
          disabled={isProcessing || isRunning}
          className="flex items-center justify-center gap-2 px-3.5 py-2.5 bg-white hover:bg-gray-50 border border-gray-300 text-neutral-800 text-xs font-semibold rounded-lg transition disabled:opacity-50 cursor-pointer shadow-2xs"
        >
          {isProcessing && !isRunning ? (
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Plus className="w-3.5 h-3.5" />
          )}
          <span>Generate One Ticket</span>
        </button>

        {/* Start / Stop Toggle */}
        {isRunning ? (
          <button
            type="button"
            onClick={handleStop}
            className="flex items-center justify-center gap-2 px-3.5 py-2.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-lg transition cursor-pointer shadow-xs"
          >
            <Square className="w-3.5 h-3.5 fill-current" />
            <span>Stop Simulation</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={handleStart}
            disabled={!orgId || !deptId}
            className="flex items-center justify-center gap-2 px-3.5 py-2.5 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition cursor-pointer shadow-xs"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>Start Simulation</span>
          </button>
        )}

        {/* Configurable Interval Input */}
        <div className="flex items-center justify-between px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-xs">
          <label htmlFor="kiosk-interval" className="text-gray-600 font-medium">
            Interval:
          </label>
          <div className="flex items-center gap-1">
            <input
              id="kiosk-interval"
              type="number"
              min="3"
              max="30"
              disabled={isRunning}
              value={intervalSec}
              onChange={(e) => setIntervalSec(Math.max(3, Math.min(30, parseInt(e.target.value, 10) || 10)))}
              className="w-14 bg-white border border-gray-300 rounded px-2 py-1 text-center font-mono text-neutral-900 font-bold focus:outline-none focus:border-emerald-600 disabled:bg-gray-100"
            />
            <span className="text-gray-500 font-medium">sec</span>
          </div>
        </div>
      </div>

      {/* Status Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-1 text-xs text-gray-600 border-t border-gray-100">
        <div>
          Tickets generated this session: <strong className="text-neutral-900">{sessionCount}</strong>
        </div>

        {lastTicket && (
          <div className="flex items-center gap-1.5 text-emerald-800 bg-emerald-50 px-2.5 py-1 rounded-md border border-emerald-200">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" />
            <span>Last Ticket: <strong className="font-mono text-neutral-900">{lastTicket}</strong></span>
          </div>
        )}
      </div>
    </div>
  );
}