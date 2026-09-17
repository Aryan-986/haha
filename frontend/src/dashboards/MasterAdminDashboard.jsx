import React, { useState } from 'react';
import axios from 'axios';
import { Building, PlusCircle, ShieldCheck } from 'lucide-react';

export default function MasterAdminDashboard() {
  const [formData, setFormData] = useState({ name: '', office: '', activeCounters: 2 });
  const [status, setStatus] = useState('');

  const handleAddOrganization = async (e) => {
    e.preventDefault();
    try {
      await axios.post('http://localhost:5000/api/admin/organizations/add', formData);
      setStatus('Organization successfully created!');
      setFormData({ name: '', office: '', activeCounters: 2 });
    } catch (err) {
      setStatus('Failed to create organization.');
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-white">Master Admin Portal</h1>
        <span className="bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 text-xs px-3 py-1 rounded-full font-semibold flex items-center gap-1.5">
          <ShieldCheck className="w-4 h-4" /> Role: Master Admin
        </span>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
        <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
          <Building className="w-5 h-5 text-indigo-400" /> Add New Public Organization / Office
        </h3>

        <form onSubmit={handleAddOrganization} className="space-y-4">
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Service Name</label>
            <input
              type="text"
              placeholder="e.g. NID Biometrics & Verification"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-indigo-500"
              required
            />
          </div>

          <div>
            <label className="text-xs text-slate-400 mb-1 block">Office / Department Location</label>
            <input
              type="text"
              placeholder="e.g. District Administration Office (DAO) Kathmandu"
              value={formData.office}
              onChange={(e) => setFormData({ ...formData, office: e.target.value })}
              className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-indigo-500"
              required
            />
          </div>

          <button
            type="submit"
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold py-3 px-6 rounded-xl transition active:scale-95"
          >
            <PlusCircle className="w-4 h-4" /> Create Organization
          </button>
        </form>

        {status && <p className="text-xs text-emerald-400 mt-4">{status}</p>}
      </div>
    </div>
  );
}