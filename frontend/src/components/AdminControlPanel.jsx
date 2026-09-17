import React from 'react';
import { Plus, Minus, Settings, ToggleLeft } from 'lucide-react';

export default function AdminControlPanel({ onSimulate }) {
  return (
    <div className="bg-slate-950 border border-indigo-900/50 rounded-2xl p-5 mt-8 shadow-2xl">
      <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <Settings className="w-4 h-4 text-indigo-400" />
          <h4 className="text-sm font-bold text-white uppercase tracking-wider">Live Simulation Control Panel</h4>
        </div>
        <span className="text-xs bg-indigo-950 text-indigo-300 border border-indigo-800/50 px-2 py-0.5 rounded font-mono">Demo Admin</span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <button 
          onClick={() => onSimulate(5, 0)}
          className="flex items-center justify-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700 py-2 px-3 rounded-xl text-xs font-semibold transition active:scale-95"
        >
          <Plus className="w-3.5 h-3.5 text-red-400" /> +5 Queue
        </button>

        <button 
          onClick={() => onSimulate(-3, 0)}
          className="flex items-center justify-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700 py-2 px-3 rounded-xl text-xs font-semibold transition active:scale-95"
        >
          <Minus className="w-3.5 h-3.5 text-emerald-400" /> -3 Queue
        </button>

        <button 
          onClick={() => onSimulate(0, 1)}
          className="flex items-center justify-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700 py-2 px-3 rounded-xl text-xs font-semibold transition active:scale-95"
        >
          <ToggleLeft className="w-3.5 h-3.5 text-indigo-400" /> +1 Counter
        </button>

        <button 
          onClick={() => onSimulate(0, -1)}
          className="flex items-center justify-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700 py-2 px-3 rounded-xl text-xs font-semibold transition active:scale-95"
        >
          <ToggleLeft className="w-3.5 h-3.5 text-amber-400" /> -1 Counter
        </button>
      </div>
    </div>
  );
}