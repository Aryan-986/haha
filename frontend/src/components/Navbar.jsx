import React from 'react';
import { Clock, Activity } from 'lucide-react';

export default function Navbar() {
  return (
    <nav className="bg-slate-900 border-b border-slate-800 text-white px-6 py-4 flex items-center justify-between shadow-lg">
      <div className="flex items-center gap-3">
        <div className="bg-indigo-600 p-2 rounded-xl text-white shadow-indigo-500/30 shadow-md">
          <Clock className="w-6 h-6" />
        </div>
        <div>
          <h1 className="font-bold text-xl tracking-tight bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent">
            QueueLess
          </h1>
          <p className="text-xs text-slate-400">AI Crowd & Queue Intelligence</p>
        </div>
      </div>

      <div className="flex items-center gap-2 bg-emerald-950/60 border border-emerald-800/60 px-3 py-1.5 rounded-full text-xs font-medium text-emerald-400">
        <Activity className="w-3.5 h-3.5 animate-pulse" />
        Live System Active
      </div>
    </nav>
  );
}