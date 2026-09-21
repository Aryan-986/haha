import React, { useState, useEffect } from 'react';
import axios from 'axios';
import CurrentQueueCard from '../components/CurrentQueueCard';
import CrowdForecastChart from '../components/CrowdForecastChart';
import GeminiAdviceCard from '../components/GeminiAdviceCard';

const API_BASE = 'http://localhost:5000/api/v1';

export default function CitizenDashboard() {
  const [organizations, setOrganizations] = useState([]);
  const [selectedOrgId, setSelectedOrgId] = useState('');
  const [departments, setDepartments] = useState([]);
  const [selectedDeptId, setSelectedDeptId] = useState('');

  const [queueData, setQueueData] = useState(null);
  const [loading, setLoading] = useState(true);

  // 1. Fetch all Organizations added by Master Admin
  useEffect(() => {
    const fetchOrganizations = async () => {
      try {
        const res = await axios.get(`${API_BASE}/orgs`);
        if (res.data && res.data.length > 0) {
          setOrganizations(res.data);
          setSelectedOrgId(res.data[0]._id);
        }
      } catch (err) {
        console.error('Error fetching organizations:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchOrganizations();
  }, []);

  // 2. Fetch Departments when Organization changes
  useEffect(() => {
    if (!selectedOrgId) return;

    const fetchDepartments = async () => {
      try {
        const res = await axios.get(`${API_BASE}/orgs/${selectedOrgId}/departments`);
        const depts = res.data || [];
        setDepartments(depts);
        if (depts.length > 0) {
          setSelectedDeptId(depts[0]._id);
        } else {
          setSelectedDeptId('');
        }
      } catch (err) {
        console.error('Error fetching departments:', err);
      }
    };

    fetchDepartments();
  }, [selectedOrgId]);

  // 3. Fetch Live Queue Metrics for selected Department
  const fetchQueueData = async () => {
    if (!selectedDeptId) return;

    try {
      const statusRes = await axios.get(`${API_BASE}/queue/${selectedDeptId}`);
      const data = statusRes.data || {};

      setQueueData({
        currentQueueCount: data.currentQueueCount ?? 0,
        estimatedWaitMin: data.estimatedWaitMin ?? (data.currentQueueCount * 3) ?? 15,
        crowdLevel: data.crowdLevel || 'MODERATE CROWD',
        activeCounters: data.activeCounters ?? 1,
        forecast: data.forecast || [
          { hour: '9:00 AM', crowd: 120 },
          { hour: '11:00 AM', crowd: 180 },
          { hour: '1:00 PM', crowd: 150 },
          { hour: '3:00 PM', crowd: 90 },
          { hour: '5:00 PM', crowd: 40 }
        ],
        bestTimeWindow: data.bestTimeWindow || '3:00 PM - 4:00 PM'
      });
    } catch (err) {
      console.error('Error fetching live queue data:', err);
    }
  };

  useEffect(() => {
    fetchQueueData();
    const interval = setInterval(fetchQueueData, 3000);
    return () => clearInterval(interval);
  }, [selectedDeptId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-indigo-500"></div>
      </div>
    );
  }

  const currentOrg = organizations.find((o) => o._id === selectedOrgId);
  const currentDept = departments.find((d) => d._id === selectedDeptId);

  return (
    <main className="max-w-5xl mx-auto px-6 pt-6 pb-12 space-y-6 text-slate-100">
      {/* Dynamic Header with Organization & Department Dropdowns */}
      <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-lg space-y-4">
        <span className="text-xs font-semibold text-indigo-400 uppercase tracking-wider block">
          Select Service Location
        </span>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Organization Selector */}
          <div className="relative">
            <label className="block text-xs font-semibold text-slate-400 mb-1">
              Organization / Office
            </label>
            <select
              value={selectedOrgId}
              onChange={(e) => setSelectedOrgId(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 text-sm font-bold text-white rounded-xl p-3 appearance-none focus:outline-none focus:border-indigo-500 cursor-pointer pr-10 transition"
            >
              {organizations.map((org) => (
                <option key={org._id} value={org._id}>
                  {org.name}
                </option>
              ))}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 pt-5 text-slate-400">
              ▼
            </div>
          </div>

          {/* Department / Desk Selector */}
          <div className="relative">
            <label className="block text-xs font-semibold text-slate-400 mb-1">
              Department / Service Desk
            </label>
            <select
              value={selectedDeptId}
              onChange={(e) => setSelectedDeptId(e.target.value)}
              disabled={departments.length === 0}
              className="w-full bg-slate-800 border border-slate-700 text-sm font-medium text-slate-200 rounded-xl p-3 appearance-none focus:outline-none focus:border-indigo-500 cursor-pointer pr-10 disabled:opacity-50 transition"
            >
              {departments.length === 0 ? (
                <option value="">No departments available</option>
              ) : (
                departments.map((dept) => (
                  <option key={dept._id} value={dept._id}>
                    {dept.name} ({dept.prefix}) {dept.isEntryLevel ? '[Entry Desk]' : ''}
                  </option>
                ))
              )}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 pt-5 text-slate-400">
              ▼
            </div>
          </div>
        </div>
      </div>

      {/* Core Grid Dashboard */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-1">
          <CurrentQueueCard
            currentQueue={queueData?.currentQueueCount ?? 0}
            waitTime={queueData?.estimatedWaitMin ?? 0}
            crowdLevel={queueData?.crowdLevel ?? 'LOW CROWD'}
            activeCounters={queueData?.activeCounters ?? 1}
          />
        </div>

        <div className="md:col-span-2">
          <CrowdForecastChart
            forecast={queueData?.forecast ?? []}
            bestTimeWindow={queueData?.bestTimeWindow ?? '3:00 PM - 4:00 PM'}
          />
        </div>
      </div>

      {/* AI Advice Module */}
      <GeminiAdviceCard
        serviceId={selectedDeptId}
        currentQueue={queueData?.currentQueueCount}
        bestTimeWindow={queueData?.bestTimeWindow}
      />
    </main>
  );
}