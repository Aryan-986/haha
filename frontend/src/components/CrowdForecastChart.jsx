import React from 'react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { TrendingUp, Sparkles } from 'lucide-react';

export default function CrowdForecastChart({ forecast, bestTimeWindow }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-6">
        <div>
          <div className="flex items-center gap-2 text-indigo-400 text-sm font-semibold">
            <TrendingUp className="w-4 h-4" />
            AI Forecast Engine
          </div>
          <h3 className="text-lg font-bold text-white">Hourly Crowd Prediction</h3>
        </div>

        <div className="bg-emerald-950/80 border border-emerald-800/80 px-3 py-1.5 rounded-xl flex items-center gap-2 text-xs font-semibold text-emerald-400">
          <Sparkles className="w-3.5 h-3.5" />
          Best Visit Window: {bestTimeWindow}
        </div>
      </div>

      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={forecast} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="queueColor" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.4}/>
                <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="hour" stroke="#64748b" fontSize={12} tickLine={false} />
            <YAxis stroke="#64748b" fontSize={12} tickLine={false} />
            <Tooltip 
              contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '0.75rem', color: '#fff' }}
              formatter={(value) => [`${value} people`, 'Predicted Queue']}
            />
            <Area type="monotone" dataKey="predictedQueue" stroke="#6366f1" strokeWidth={3} fillOpacity={1} fill="url(#queueColor)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}