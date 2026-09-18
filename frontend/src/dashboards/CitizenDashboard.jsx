import React, { useState, useEffect } from 'react';
import axios from 'axios';
import CurrentQueueCard from '../components/CurrentQueueCard';
import CrowdForecastChart from '../components/CrowdForecastChart';
import GeminiAdviceCard from '../components/GeminiAdviceCard';

const API_BASE = 'http://localhost:5000/api';

export default function CitizenDashboard() {
  const [service, setService] = useState(null);
  const [queueData, setQueueData] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchQueueData = async () => {
    try {
      const servicesRes = await axios.get(`${API_BASE}/services`);
      if (servicesRes.data && servicesRes.data.length > 0) {
        const primaryService = servicesRes.data[0];
        setService(primaryService);

        const statusRes = await axios.get(`${API_BASE}/queue/${primaryService._id}`);
        
        setQueueData({
          currentQueueCount: statusRes.data?.currentQueueCount ?? primaryService?.currentQueueCount ?? 0,
          estimatedWaitMin: statusRes.data?.estimatedWaitMin ?? (statusRes.data?.currentQueueCount * 3) ?? 15,
          crowdLevel: statusRes.data?.crowdLevel || 'MODERATE CROWD',
          activeCounters: statusRes.data?.activeCounters ?? primaryService?.activeCounters ?? 1,
          forecast: statusRes.data?.forecast || [
            { hour: '9:00 AM', crowd: 120 },
            { hour: '11:00 AM', crowd: 180 },
            { hour: '1:00 PM', crowd: 150 },
            { hour: '3:00 PM', crowd: 90 },
            { hour: '5:00 PM', crowd: 40 }
          ],
          bestTimeWindow: statusRes.data?.bestTimeWindow || '3:00 PM - 4:00 PM'
        });
      }
    } catch (err) {
      console.error('Error loading Citizen Dashboard:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchQueueData();
    const interval = setInterval(fetchQueueData, 2000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-indigo-500"></div>
      </div>
    );
  }

  return (
    <main className="max-w-5xl mx-auto px-6 pt-6 pb-12 space-y-6">
      {/* Service Header */}
      <div>
        <h2 className="text-2xl font-bold text-white">
          {service?.office || 'District Administration Office (DAO), Kathmandu'}
        </h2>
        <p className="text-sm text-slate-400">
          {service?.name || 'Citizenship & National ID Application'}
        </p>
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
        serviceId={service?._id}
        currentQueue={queueData?.currentQueueCount}
        bestTimeWindow={queueData?.bestTimeWindow}
      />
    </main>
  );
}