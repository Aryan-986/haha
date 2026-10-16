import React, { useState, useEffect } from 'react';
import { useUser, UserButton, SignInButton } from '@clerk/clerk-react';
import { ShieldCheck, User, Briefcase, Search, Activity, Clock, AlertCircle, LogIn, Lock, RefreshCw } from 'lucide-react';

import CitizenDashboard from '../dashboards/CitizenDashboard';
import WorkerDashboard from '../dashboards/WorkerDashboard';
import SupervisorDashboard from '../dashboards/SupervisorDashboard';
import MasterAdminDashboard from '../dashboards/MasterAdminDashboard';
import TicketTracker from '../components/TicketTracker';
import AccessRequestForm from '../components/AccessRequestForm';
import { getMyAccessStatus } from '../services/accessRequestService';

export default function Dashboard() {
  const { user, isLoaded, isSignedIn } = useUser();
  const [activeView, setActiveView] = useState('dashboard'); // 'dashboard' | 'tracker'
  const [selectedPortal, setSelectedPortal] = useState('citizen'); // 'citizen' | 'worker' | 'supervisor' | 'master_admin'

  // Server-authoritative access status
  const [accessStatus, setAccessStatus] = useState({
    loading: false,
    isMasterAdmin: false,
    hasApprovedAccess: false,
    role: null,
    pendingRequests: [],
    approvedMemberships: []
  });

  useEffect(() => {
    if (isSignedIn) {
      checkStatus();
    } else {
      setAccessStatus({
        loading: false,
        isMasterAdmin: false,
        hasApprovedAccess: false,
        role: null,
        pendingRequests: [],
        approvedMemberships: []
      });
      setSelectedPortal('citizen');
    }
  }, [isSignedIn, user?.id]);

  async function checkStatus() {
    setAccessStatus(prev => ({ ...prev, loading: true }));
    try {
      const data = await getMyAccessStatus();
      setAccessStatus({
        loading: false,
        isMasterAdmin: !!data.isMasterAdmin,
        hasApprovedAccess: !!data.hasApprovedAccess,
        role: data.role || null,
        pendingRequests: data.pendingRequests || [],
        approvedMemberships: data.approvedMemberships || []
      });

      // Auto-route on initial load if user has specific privileges
      if (data.isMasterAdmin && selectedPortal === 'citizen') {
        setSelectedPortal('master_admin');
      } else if (data.hasApprovedAccess && data.role && selectedPortal === 'citizen') {
        setSelectedPortal(data.role.toLowerCase());
      }
    } catch (err) {
      console.warn('Failed to verify access status:', err.message);
      setAccessStatus(prev => ({ ...prev, loading: false }));
    }
  }

  if (!isLoaded || accessStatus.loading) {
    return (
      <div className="flex flex-col justify-center items-center h-screen bg-white text-gray-600 gap-3">
        <RefreshCw className="w-6 h-6 text-emerald-600 animate-spin" />
        <span className="text-sm font-medium">Verifying QueueLess authorization...</span>
      </div>
    );
  }

  // Determine authorized rendering
  const renderDashboardContent = () => {
    // 1. Citizen Portal: Always publicly available (NO AUTH NEEDED)
    if (selectedPortal === 'citizen') {
      return <CitizenDashboard />;
    }

    // 2. Unauthenticated user trying to access staff portals
    if (!isSignedIn) {
      return (
        <div className="max-w-md mx-auto my-16 p-8 bg-white border border-gray-200 rounded-xl shadow-xs text-center">
          <div className="w-12 h-12 bg-emerald-50 text-emerald-700 rounded-full flex items-center justify-center mx-auto mb-4">
            <Lock className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-bold text-neutral-900 mb-2">Staff Authentication Required</h2>
          <p className="text-xs text-gray-600 mb-6 leading-relaxed">
            Citizens can use QueueLess freely without an account. However, operational dashboards (Worker, Supervisor, Admin) require verified staff authentication.
          </p>
          <SignInButton mode="modal">
            <button
              type="button"
              className="w-full py-2.5 px-4 bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-xs rounded-lg transition shadow-xs flex items-center justify-center gap-2 cursor-pointer"
            >
              <LogIn className="w-4 h-4" />
              <span>Sign In with Clerk</span>
            </button>
          </SignInButton>
        </div>
      );
    }

    // 3. Master Admin Portal
    if (selectedPortal === 'master_admin') {
      if (accessStatus.isMasterAdmin) {
        return <MasterAdminDashboard />;
      }
      return (
        <div className="max-w-md mx-auto my-16 p-8 bg-white border border-red-200 rounded-xl shadow-xs text-center">
          <AlertCircle className="w-12 h-12 text-red-600 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-neutral-900 mb-2">Access Denied: Master Admin Only</h2>
          <p className="text-xs text-gray-600 mb-4">
            Master administrative controls are restricted to verified administrators (<span className="font-semibold">aryankarki984@gmail.com</span>). Your account is not authorized for global system administration.
          </p>
          <button
            type="button"
            onClick={() => setSelectedPortal('citizen')}
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-neutral-800 text-xs font-semibold rounded-lg transition cursor-pointer"
          >
            Return to Citizen Portal
          </button>
        </div>
      );
    }

    // 4. Worker or Supervisor Portal
    if (selectedPortal === 'worker' || selectedPortal === 'supervisor') {
      // If user is Master Admin, grant seamless preview access
      if (accessStatus.isMasterAdmin) {
        return selectedPortal === 'worker' ? <WorkerDashboard /> : <SupervisorDashboard />;
      }

      // Check if user has approved membership for this role
      const hasMatchingApprovedRole = accessStatus.approvedMemberships.some(
        m => m.role?.toLowerCase() === selectedPortal && m.status !== 'DEACTIVATED'
      );

      if (hasMatchingApprovedRole) {
        return selectedPortal === 'worker' ? <WorkerDashboard /> : <SupervisorDashboard />;
      }

      // If user has pending requests or no membership, show the Access Request workflow
      return (
        <AccessRequestForm onStatusChange={checkStatus} />
      );
    }

    return <CitizenDashboard />;
  };

  if (activeView === 'tracker') {
    return <TicketTracker onBack={() => setActiveView('dashboard')} />;
  }

  return (
    <div className="min-h-screen bg-white text-neutral-900">
      {/* Universal Top Navigation Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-2.5 flex flex-wrap justify-between items-center gap-3">
          {/* Brand & Portal Selector */}
          <div className="flex items-center gap-3 sm:gap-6 flex-wrap">
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
                  setSelectedPortal('citizen');
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition cursor-pointer ${
                  selectedPortal === 'citizen'
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
                  setSelectedPortal('worker');
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition cursor-pointer ${
                  selectedPortal === 'worker'
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
                  setSelectedPortal('supervisor');
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition cursor-pointer ${
                  selectedPortal === 'supervisor'
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
                  setSelectedPortal('master_admin');
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition cursor-pointer ${
                  selectedPortal === 'master_admin'
                    ? 'bg-emerald-700 text-white shadow-2xs'
                    : 'text-gray-600 hover:text-neutral-900'
                }`}
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Master Admin</span>
                {accessStatus.isMasterAdmin && (
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                )}
              </button>
            </div>
          </div>

          {/* Right Header: Token Tracker & Auth Profile */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setActiveView('tracker')}
              className="flex items-center gap-1.5 bg-white hover:bg-gray-50 text-gray-700 text-xs font-semibold px-3 py-1.5 rounded-lg border border-gray-300 transition cursor-pointer shadow-2xs"
            >
              <Search className="w-3.5 h-3.5 text-gray-500" />
              <span>Track Token</span>
            </button>

            {isSignedIn ? (
              <div className="flex items-center gap-2 pl-2 border-l border-gray-200">
                <UserButton afterSignOutUrl="/" />
              </div>
            ) : (
              <SignInButton mode="modal">
                <button
                  type="button"
                  className="flex items-center gap-1.5 bg-neutral-900 hover:bg-neutral-800 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition cursor-pointer shadow-2xs"
                >
                  <LogIn className="w-3.5 h-3.5" />
                  <span>Staff Login</span>
                </button>
              </SignInButton>
            )}
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="bg-white">
        {renderDashboardContent()}
      </main>
    </div>
  );
}