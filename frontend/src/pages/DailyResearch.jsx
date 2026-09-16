import React from 'react';
import { apiFetch, useData } from '../quant-platform.jsx';
import TradingViewPanel from '../components/TradingViewPanel.jsx';
import DailyWatchlistPanel from '../components/DailyWatchlistPanel.jsx';
export default function DailyResearch() {
  const { stocks } = useData();
  return <div className="h-full overflow-y-auto p-4 md:p-6"><div className="max-w-6xl mx-auto space-y-4"><DailyWatchlistPanel request={apiFetch} stocks={stocks} /><TradingViewPanel request={apiFetch} /></div></div>;
}
