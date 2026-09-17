import React from 'react';
import { Users, Clock, ShieldAlert } from 'lucide-react';

export default function CurrentQueueCard({ currentQueue, waitTime, crowdLevel, activeCounters }) {
  const getBadgeStyle = (level) => {
    switch (level) {
      case 'HIGH':
        return 'bg-red-500/10 text-red-400 border-red-500/20';
      case 'MODERATE':
        return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
      default:
        return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl relative overflow-hidden">
      <div className="flex items-start justify-between">
        <div>
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Live Status</span>
          <h2 className="text-3xl font-extrabold text-white mt-1">{currentQueue} <span className="text-base font-normal text-slate-400">people waiting</span></h2>
        </div>
        <span className={`px-3 py-1 rounded-full text-xs font-bold border ${getBadgeStyle(crowdLevel)} flex items-center gap-1.5`}>
          <ShieldAlert className="w-3.5 h-3.5" />
          {crowdLevel} CROWD
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4 mt-6 pt-6 border-t border-slate-800">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-indigo-500/10 text-indigo-400">
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <p className="text-xs text-slate-400 font-medium">Estimated Wait</p>
            <p className="text-lg font-bold text-white">~{waitTime} mins</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-indigo-500/10 text-indigo-400">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <p className="text-xs text-slate-400 font-medium">Open Counters</p>
            <p className="text-lg font-bold text-white">{activeCounters} Active</p>
          </div>
        </div>
      </div>
    </div>
  );
}