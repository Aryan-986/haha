import React, { useState } from 'react';
import { useUser } from '@clerk/clerk-react';
import { ShieldCheck, User, Briefcase, Search, LayoutDashboard } from 'lucide-react';

// Default imports matching your dashboard and component exports
import CitizenDashboard from '../dashboards/CitizenDashboard';
import WorkerDashboard from '../dashboards/WorkerDashboard';
import MasterAdminDashboard from '../dashboards/MasterAdminDashboard';
import TicketTracker from '../components/TicketTracker';

export default function Dashboard() {
  const { user, isLoaded, isSignedIn } = useUser();
  const [activeView, setActiveView] = useState('dashboard'); // 'dashboard' | 'tracker'
  const [overrideRole, setOverrideRole] = useState(null); // Allows quick portal switching in dev

  if (!isLoaded) {
    return (
      <div className="flex justify-center items-center h-64 text-slate-400">
        Loading user session...
      </div>
    );
  }

  const clerkRole = isSignedIn ? (user?.publicMetadata?.role || 'citizen') : 'citizen';
  const currentRole = overrideRole || clerkRole;

  // Render role-based internal dashboard content
  const renderDashboardContent = () => {
    switch (currentRole) {
      case 'master_admin':
        return <MasterAdminDashboard />;
      case 'worker':
        return <WorkerDashboard />;
      case 'citizen':
      default:
        return <CitizenDashboard />;
    }
  };

  // If user opened the Ticket Tracker view directly
  if (activeView === 'tracker') {
    return <TicketTracker onBack={() => setActiveView('dashboard')} />;
  }

  return (
    <div className="min-h-screen bg-slate-950">
      {/* Universal Top Portal Navigation & View Switcher */}
      <div className="bg-slate-900 border-b border-slate-800 px-6 py-2.5 flex flex-wrap justify-between items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 text-[11px] text-slate-400">
            <LayoutDashboard className="w-3.5 h-3.5 text-indigo-400" />
            <span>Portal Switcher:</span>
          </div>

          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
            <button
              onClick={() => {
                setActiveView('dashboard');
                setOverrideRole('master_admin');
              }}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition cursor-pointer ${currentRole === 'master_admin'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-white'
                }`}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Master Admin</span>
            </button>

            <button
              onClick={() => {
                setActiveView('dashboard');
                setOverrideRole('citizen');
              }}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition cursor-pointer ${currentRole === 'citizen'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-white'
                }`}
            >
              <User className="w-3.5 h-3.5" />
              <span>Citizen</span>
            </button>

            <button
              onClick={() => {
                setActiveView('dashboard');
                setOverrideRole('worker');
              }}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition cursor-pointer ${currentRole === 'worker'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-white'
                }`}
            >
              <Briefcase className="w-3.5 h-3.5" />
              <span>Worker</span>
            </button>
          </div>
        </div>

        <button
          onClick={() => setActiveView('tracker')}
          className="flex items-center gap-2 bg-indigo-600/20 hover:bg-indigo-600 text-indigo-300 hover:text-white text-xs font-semibold px-3.5 py-1.5 rounded-xl border border-indigo-500/30 transition shadow-sm cursor-pointer"
        >
          <Search className="w-3.5 h-3.5" />
          <span>Track Token & Wait Times</span>
        </button>
      </div>

      {/* Main Dashboard View */}
      {renderDashboardContent()}
    </div>
  );
}