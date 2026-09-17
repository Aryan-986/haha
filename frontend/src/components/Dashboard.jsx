import React, { useState } from 'react';
import { useUser } from '@clerk/clerk-react';

// Default imports matching your dashboard and component exports
import CitizenDashboard from '../dashboards/CitizenDashboard';
import WorkerDashboard from '../dashboards/WorkerDashboard';
import MasterAdminDashboard from '../dashboards/MasterAdminDashboard';
import TicketTracker from '../components/TicketTracker';

export default function Dashboard() {
  const { user, isLoaded, isSignedIn } = useUser();
  const [activeView, setActiveView] = useState('dashboard'); // 'dashboard' | 'tracker'

  if (!isLoaded) {
    return (
      <div className="flex justify-center items-center h-64 text-slate-400">
        Loading user session...
      </div>
    );
  }

  const role = isSignedIn ? (user?.publicMetadata?.role || 'citizen') : 'citizen';

  // Render role-based internal dashboard content
  const renderDashboardContent = () => {
    switch (role) {
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
      {/* Navigation Topbar for switching to Ticket Tracker */}
      {role === 'citizen' && (
        <div className="bg-slate-900 border-b border-slate-800 px-6 py-3 flex justify-between items-center">
          <div className="flex items-center space-x-2">
            <span className="text-sm font-semibold text-slate-200">QueueLess Portal</span>
          </div>

          <button
            onClick={() => setActiveView('tracker')}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold px-4 py-2 rounded-lg transition duration-200 shadow-md shadow-indigo-600/20"
          >
            <span>🔍 Track Token & Live Wait Times</span>
          </button>
        </div>
      )}

      {/* Main Dashboard View */}
      {renderDashboardContent()}
    </div>
  );
}