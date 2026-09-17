import React, { useState } from 'react';
import axios from 'axios';
import { Sparkles, FileText, CheckCircle2, Loader2 } from 'lucide-react';

export default function GeminiAdviceCard({ serviceId, currentQueue, bestTimeWindow }) {
  const [advice, setAdvice] = useState('');
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchAiAdvice = async () => {
    setLoading(true);
    try {
      const res = await axios.post('http://localhost:5000/api/analyze', {
        serviceId,
        currentQueue,
        bestTimeWindow
      });
      setAdvice(res.data.advice);
      setDocuments(res.data.documents || []);
    } catch (err) {
      console.error('Error fetching AI advice:', err);
      setAdvice('Unable to generate live strategy. Please bring all official documents.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-slate-900 border border-indigo-900/40 rounded-2xl p-6 shadow-xl mt-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-indigo-400" />
          <h3 className="text-lg font-bold text-white">Gemini AI Smart Assistant</h3>
        </div>
        
        <button
          onClick={fetchAiAdvice}
          disabled={loading}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold py-2 px-4 rounded-xl transition active:scale-95 disabled:opacity-50"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {advice ? 'Regenerate Strategy' : 'Get AI Visit Plan'}
        </button>
      </div>

      {!advice && !loading && (
        <p className="text-sm text-slate-400">
          Click the button above to generate a tailored visit recommendation and document preparation checklist via Gemini API.
        </p>
      )}

      {advice && (
        <div className="space-y-4 text-sm text-slate-300">
          <div className="bg-slate-950/70 border border-slate-800 p-4 rounded-xl whitespace-pre-line">
            {advice}
          </div>

          {documents.length > 0 && (
            <div>
              <h4 className="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                <FileText className="w-4 h-4 text-indigo-400" />
                Required Documents Checklist
              </h4>
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {documents.map((doc, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-xs bg-slate-950 border border-slate-800/80 p-2.5 rounded-lg text-slate-300">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    <span>{doc}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}