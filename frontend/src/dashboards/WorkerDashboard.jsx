import React, { useState, useEffect } from 'react';
import axios from 'axios';
import KioskHardwareSimulator from '../components/KioskHardwareSimulator';

const API_BASE = 'http://localhost:5000/api';

const WorkerDashboard = () => {
  const [service, setService] = useState(null);
  const [currentTicket, setCurrentTicket] = useState('A-100');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Fetch initial service data
  const fetchServiceData = async () => {
    try {
      const res = await axios.get(`${API_BASE}/services`);
      if (res.data && res.data.length > 0) {
        setService(res.data[0]);
      }
      setError(null);
    } catch (err) {
      console.error('Worker dashboard fetch error:', err);
      setError('Failed to load service data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchServiceData();
    // Poll backend every 2 seconds to keep worker dashboard synced with live backend
    const interval = setInterval(fetchServiceData, 2000);
    return () => clearInterval(interval);
  }, []);

  // Call Next Ticket Action
  const handleCallNext = async () => {
    if (!service?._id) return;
    try {
      const res = await axios.post(`${API_BASE}/worker/service/${service._id}/call-next`);
      if (res.data?.ticketNumber) {
        setCurrentTicket(res.data.ticketNumber);
      }
      fetchServiceData();
    } catch (err) {
      console.error('Call next error:', err);
    }
  };

  // Adjust Queue Count Manually
  const handleQueueAdjust = async (action) => {
    if (!service?._id) return;
    try {
      await axios.patch(`${API_BASE}/worker/service/${service._id}/queue`, { action });
      fetchServiceData();
    } catch (err) {
      console.error('Queue adjust error:', err);
    }
  };

  // Adjust Open Active Counters
  const handleCounterAdjust = async (newCount) => {
    if (!service?._id || newCount < 1) return;
    try {
      await axios.patch(`${API_BASE}/worker/service/${service._id}/counters`, {
        activeCounters: newCount
      });
      fetchServiceData();
    } catch (err) {
      console.error('Counter adjust error:', err);
    }
  };

  if (loading) {
    return <div className="p-8 text-center text-slate-400">Loading Counter Staff Portal...</div>;
  }

  return (
    <div className="max-w-xl mx-auto p-6 space-y-6 bg-slate-900 text-slate-100 min-h-screen">
      <header className="border-b border-slate-800 pb-4">
        <h1 className="text-2xl font-bold">Counter Staff Portal</h1>
        <p className="text-sm text-slate-400">{service?.office || 'District Administration Office (DAO)'}</p>
        <p className="text-xs text-slate-500">{service?.name || 'Citizenship Application'}</p>
      </header>

      {error && (
        <div className="bg-red-500/10 border border-red-500 text-red-400 p-3 rounded-md text-sm">
          {error}
        </div>
      )}

      {/* Hardware Kiosk API Simulator for Demo */}
      {service && (
        <KioskHardwareSimulator
          serviceId={service._id}
          onDispense={() => fetchServiceData()}
        />
      )}

      {/* Now Serving Ticket Section */}
      <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 text-center space-y-2">
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Now Serving</span>
        <div className="text-5xl font-extrabold text-indigo-400 tracking-tight">{currentTicket}</div>
        <p className="text-sm text-slate-400 pt-2">
          Remaining Waiting: <span className="font-bold text-slate-200">{service?.currentQueueCount ?? 0}</span>
        </p>

        <button
          onClick={handleCallNext}
          className="w-full mt-4 py-3 px-4 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-lg transition duration-200 shadow-lg shadow-emerald-900/20"
        >
          ✓ Call Next Ticket
        </button>
      </div>

      {/* Live Simulation & Staff Controls */}
      <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 space-y-4">
        <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider border-b border-slate-700 pb-2">
          Live Simulation Controls
        </h3>

        {/* Manual Queue Adjust */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-400">Manual Queue Adjust</span>
          <div className="flex items-center space-x-3">
            <button
              onClick={() => handleQueueAdjust('DECREMENT')}
              className="w-8 h-8 rounded bg-slate-700 hover:bg-slate-600 flex items-center justify-center font-bold text-slate-200"
            >
              -
            </button>
            <span className="font-bold text-lg w-8 text-center">{service?.currentQueueCount ?? 0}</span>
            <button
              onClick={() => handleQueueAdjust('INCREMENT')}
              className="w-8 h-8 rounded bg-slate-700 hover:bg-slate-600 flex items-center justify-center font-bold text-slate-200"
            >
              +
            </button>
          </div>
        </div>

        {/* Active Open Counters Adjust */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-400">Active Open Counters</span>
          <div className="flex items-center space-x-3">
            <button
              onClick={() => handleCounterAdjust((service?.activeCounters || 1) - 1)}
              className="w-8 h-8 rounded bg-slate-700 hover:bg-slate-600 flex items-center justify-center font-bold text-slate-200"
            >
              -
            </button>
            <span className="font-bold text-lg w-8 text-center">{service?.activeCounters ?? 1}</span>
            <button
              onClick={() => handleCounterAdjust((service?.activeCounters || 1) + 1)}
              className="w-8 h-8 rounded bg-slate-700 hover:bg-slate-600 flex items-center justify-center font-bold text-slate-200"
            >
              +
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// Explicit default export guarantees compatibility with Dashboard.jsx
export default WorkerDashboard;