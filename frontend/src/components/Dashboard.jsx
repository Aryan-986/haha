import React, { useState } from 'react';
import { useUser } from '@clerk/clerk-react';
import { ShieldCheck, User, Briefcase, Search, Activity, Layers } from 'lucide-react';

import CitizenDashboard from '../dashboards/CitizenDashboard';
import WorkerDashboard from '../dashboards/WorkerDashboard';
import SupervisorDashboard from '../dashboards/SupervisorDashboard';
import MasterAdminDashboard from '../dashboards/MasterAdminDashboard';
import TicketTracker from '../components/TicketTracker';

export default function Dashboard() {
  const { user, isLoaded, isSignedIn } = useUser();
  const [activeView, setActiveView] = useState('dashboard'); // 'dashboard' | 'tracker'
  const [overrideRole, setOverrideRole] = useState('citizen'); // default to citizen portal

  if (!isLoaded) {
    return (
      <div className="flex justify-center items-center h-64 text-gray-500 text-sm">
        Loading QueueLess...
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
      case 'supervisor':
        return <SupervisorDashboard />;
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
    <div className="min-h-screen bg-white text-neutral-900">
      {/* Universal Top Navigation Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-2.5 flex flex-wrap justify-between items-center gap-3">
          {/* Brand Logo & Portal Selector */}
          <div className="flex items-center gap-3 sm:gap-6">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-700" />
              <span className="font-extrabold tracking-tight text-base sm:text-lg text-neutral-900">
                QueueLess
              </span>
            </div>

            {/* Portal Switcher Buttons */}
            <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-lg">
              <button
                type="button"
                onClick={() => {
                  setActiveView('dashboard');
                  setOverrideRole('citizen');
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition cursor-pointer ${
                  currentRole === 'citizen'
                    ? 'bg-emerald-700 text-white shadow-2xs'
                    : 'text-gray-600 hover:text-neutral-900'
                }`}
              >
                <User className="w-3.5 h-3.5" />
                <span>Citizen</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setActiveView('dashboard');
                  setOverrideRole('worker');
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition cursor-pointer ${
                  currentRole === 'worker'
                    ? 'bg-emerald-700 text-white shadow-2xs'
                    : 'text-gray-600 hover:text-neutral-900'
                }`}
              >
                <Briefcase className="w-3.5 h-3.5" />
                <span>Worker</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setActiveView('dashboard');
                  setOverrideRole('supervisor');
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition cursor-pointer ${
                  currentRole === 'supervisor'
                    ? 'bg-emerald-700 text-white shadow-2xs'
                    : 'text-gray-600 hover:text-neutral-900'
                }`}
              >
                <Activity className="w-3.5 h-3.5" />
                <span>Supervisor</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setActiveView('dashboard');
                  setOverrideRole('master_admin');
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition cursor-pointer ${
                  currentRole === 'master_admin'
                    ? 'bg-emerald-700 text-white shadow-2xs'
                    : 'text-gray-600 hover:text-neutral-900'
                }`}
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Master Admin</span>
              </button>
            </div>
          </div>

          {/* Quick Track Token Button */}
          <button
            type="button"
            onClick={() => setActiveView('tracker')}
            className="flex items-center gap-1.5 bg-white hover:bg-gray-50 text-gray-700 text-xs font-semibold px-3 py-1.5 rounded-lg border border-gray-300 transition cursor-pointer shadow-2xs"
          >
            <Search className="w-3.5 h-3.5 text-gray-500" />
            <span>Track Any Token</span>
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="bg-white">
        {renderDashboardContent()}
      </main>
    </div>
  );
}