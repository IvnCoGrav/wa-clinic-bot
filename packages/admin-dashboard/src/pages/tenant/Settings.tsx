import React, { useEffect, useState } from 'react';
import { apiRequest } from '../../services/api';
import { 
  Settings as SettingsIcon, 
  MapPin, 
  Truck, 
  Clock, 
  Volume2, 
  ShieldCheck, 
  Check, 
  AlertTriangle,
  Map,
  Plus,
  Trash
} from 'lucide-react';

export const Settings: React.FC = () => {
  const [globalBotActive, setGlobalBotActive] = useState(true);
  const [loading, setLoading] = useState(true);
  
  // Coordinates & branch picker (persisted locally)
  const [lat, setLat] = useState(-7.2758);
  const [lng, setLng] = useState(112.7913);
  const [branchName, setBranchName] = useState('Kala Moms & Baby Spa — Mulyosari');

  // Tiering Ongkir (persisted locally)
  const [ongkirTiers, setOngkirTiers] = useState<Array<{ id: number; maxDist: number; fee: number; promoDiscount: number }>>([
    { id: 1, maxDist: 3, fee: 10000, promoDiscount: 0 },
    { id: 2, maxDist: 7, fee: 20000, promoDiscount: 0 },
    { id: 3, maxDist: 15, fee: 35000, promoDiscount: 0 },
  ]);

  // Broadcast campaign input
  const [broadcastText, setBroadcastText] = useState('');
  const [randomDelay, setRandomDelay] = useState(15); // in seconds
  const [quietHoursStart, setQuietHoursStart] = useState('21:00');
  const [quietHoursEnd, setQuietHoursEnd] = useState('08:00');

  useEffect(() => {
    async function loadSettings() {
      try {
        const data = await apiRequest('/api/admin/settings');
        setGlobalBotActive(data.globalBotActive);
        
        // Load branch from localStorage if available
        const localBranch = localStorage.getItem('kala_branch_settings');
        if (localBranch) {
          const parsed = JSON.parse(localBranch);
          setLat(parsed.lat);
          setLng(parsed.lng);
          setBranchName(parsed.name);
        }
        
        // Fetch tiers from backend API
        const tiersRes = await apiRequest('/api/admin/delivery-tiers');
        const list = Array.isArray(tiersRes) ? tiersRes : (tiersRes?.data || []);
        if (list.length > 0) {
          setOngkirTiers(list);
        }
      } catch (err) {
        console.warn('Failed to load global chatbot settings:', err);
      } finally {
        setLoading(false);
      }
    }
    loadSettings();
  }, []);

  const handleSaveGlobalToggle = async (val: boolean) => {
    try {
      await apiRequest('/api/admin/settings', {
        method: 'PATCH',
        body: JSON.stringify({ globalBotActive: val })
      });
      setGlobalBotActive(val);
      alert(`Chatbot status changed to: ${val ? 'ACTIVE (ON)' : 'DISABLED (OFF)'}`);
    } catch (err: any) {
      alert(`Failed to change bot status: ${err.message}`);
    }
  };

  const handleSaveBranch = () => {
    localStorage.setItem('kala_branch_settings', JSON.stringify({
      lat,
      lng,
      name: branchName
    }));
    alert('Branch coordinates updated successfully!');
  };

  const handleSaveOngkirTiers = async () => {
    try {
      await apiRequest('/api/admin/delivery-tiers', {
        method: 'POST',
        body: JSON.stringify({ tiers: ongkirTiers })
      });
      alert('Delivery fee tierings updated successfully on server!');
    } catch (err: any) {
      alert(`Failed to save delivery fee tierings: ${err.message}`);
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h2 className="text-3xl font-extrabold tracking-tight text-white flex items-center space-x-3">
          <SettingsIcon className="text-pink-400" />
          <span>Operational Settings</span>
        </h2>
        <p className="text-slate-400">Configure coordinates, delivery tiers, active engines, and auto-responders</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        
        {/* Left column: Bot Toggle & Branch picker */}
        <div className="space-y-8">
          
          {/* Bot ON/OFF Toggle */}
          <div className="glass-panel border border-white/5 rounded-2xl p-6 space-y-4">
            <h3 className="text-base font-bold text-white flex items-center space-x-2">
              <ShieldCheck className="text-pink-400" />
              <span>Global Chatbot Toggle</span>
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Enable or disable the AI responder engine globally. When disabled, all incoming WhatsApp messages are automatically bypassed and routed directly to human handling.
            </p>

            <div className="flex items-center justify-between p-4 rounded-xl bg-slate-950 border border-white/5 mt-4">
              <span className="text-sm font-semibold text-slate-300">
                AI Auto-Responder Bot
              </span>
              <button
                onClick={() => handleSaveGlobalToggle(!globalBotActive)}
                className={`w-14 h-7 rounded-full transition-all relative ${globalBotActive ? 'bg-emerald-500' : 'bg-rose-500'}`}
              >
                <div className={`absolute top-1 left-1 bg-white h-5 w-5 rounded-full transition-all ${globalBotActive ? 'translate-x-7' : ''}`}></div>
              </button>
            </div>
          </div>

          {/* Coordinate picker & Branch Map */}
          <div className="glass-panel border border-white/5 rounded-2xl p-6 space-y-4">
            <h3 className="text-base font-bold text-white flex items-center space-x-2">
              <MapPin className="text-pink-400" />
              <span>Branch Coordinate Picker (Map)</span>
            </h3>

            {/* Out of scope Alert banner */}
            <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-start space-x-2 text-[10px]">
              <AlertTriangle className="flex-shrink-0 mt-0.5" size={14} />
              <div>
                <p className="font-bold">UI Demo Only (Belum Tersambung Backend Tier 2.4)</p>
                <p className="mt-0.5 text-amber-500/80">
                  Data koordinat cabang yang diinput di sini hanya tersimpan lokal di browser dan belum terintegrasi dengan backend delivery.service.ts.
                </p>
              </div>
            </div>

            <p className="text-xs text-slate-400">
              Set the GPS location of the clinic branch. This is the starting point for calculating distance-based homecare delivery fees.
            </p>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400">Branch Name</label>
                <input
                  type="text"
                  value={branchName}
                  onChange={(e) => setBranchName(e.target.value)}
                  className="w-full p-2.5 bg-slate-950 border border-white/5 rounded-xl text-xs text-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs text-slate-400">Latitude</label>
                  <input
                    type="number"
                    step="0.0001"
                    value={lat}
                    onChange={(e) => setLat(parseFloat(e.target.value))}
                    className="w-full p-2.5 bg-slate-950 border border-white/5 rounded-xl text-xs text-white"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-slate-400">Longitude</label>
                  <input
                    type="number"
                    step="0.0001"
                    value={lng}
                    onChange={(e) => setLng(parseFloat(e.target.value))}
                    className="w-full p-2.5 bg-slate-950 border border-white/5 rounded-xl text-xs text-white"
                  />
                </div>
              </div>

              {/* Simulated Map */}
              <div className="h-40 rounded-xl bg-slate-950 border border-white/5 relative overflow-hidden flex items-center justify-center">
                <Map className="absolute text-slate-800 w-full h-full opacity-20" />
                <div className="relative text-center space-y-1">
                  <MapPin className="mx-auto text-pink-400 animate-bounce" size={24} />
                  <p className="text-[10px] text-slate-400 font-semibold">{branchName}</p>
                  <p className="text-[9px] text-slate-500">[{lat}, {lng}]</p>
                </div>
              </div>

              <button
                onClick={handleSaveBranch}
                className="px-4 py-2 bg-pink-500 hover:bg-pink-600 text-white rounded-xl text-xs font-bold transition flex items-center space-x-1.5"
              >
                <Check size={14} />
                <span>Save Location Coordinates</span>
              </button>
            </div>
          </div>

        </div>

        {/* Right column: Tiering Ongkir & Broadcast Engine */}
        <div className="space-y-8">
          
          {/* Delivery fee tiering */}
          <div className="glass-panel border border-white/5 rounded-2xl p-6 space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-base font-bold text-white flex items-center space-x-2">
                <Truck className="text-pink-400" />
                <span>Delivery Fee Tiering (Homecare)</span>
              </h3>
              <span className="px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[9px] font-bold">
                Haversine Active
              </span>
            </div>
            
            <p className="text-xs text-slate-400 leading-relaxed">
              Tentukan tarif biaya pengiriman (ongkir) normal dan potongan promo berdasarkan jarak haversine rute dari koordinat spa ke lokasi customer. Editor lengkap dengan simulasi ada di menu <span className="text-pink-400 font-semibold">Delivery Fee</span>.
            </p>

            <div className="space-y-3">
              {ongkirTiers.map((tier, idx) => (
                <div key={tier.id} className="grid grid-cols-4 gap-2 items-end">
                  <div className="space-y-1">
                    <label className="text-[9px] text-slate-500 block uppercase font-bold">Max Dist (km)</label>
                    <input
                      type="number"
                      value={tier.maxDist}
                      onChange={(e) => {
                        const newTiers = [...ongkirTiers];
                        newTiers[idx].maxDist = parseFloat(e.target.value);
                        setOngkirTiers(newTiers);
                      }}
                      className="w-full p-2 bg-slate-950 border border-white/5 rounded-lg text-xs text-white"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] text-slate-500 block uppercase font-bold">Normal Fee (Rp)</label>
                    <input
                      type="number"
                      value={tier.fee}
                      onChange={(e) => {
                        const newTiers = [...ongkirTiers];
                        newTiers[idx].fee = parseInt(e.target.value);
                        setOngkirTiers(newTiers);
                      }}
                      className="w-full p-2 bg-slate-950 border border-white/5 rounded-lg text-xs text-white"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] text-slate-500 block uppercase font-bold">Promo Disc (Rp)</label>
                    <input
                      type="number"
                      value={tier.promoDiscount !== undefined ? tier.promoDiscount : 0}
                      onChange={(e) => {
                        const newTiers = [...ongkirTiers];
                        newTiers[idx].promoDiscount = parseInt(e.target.value) || 0;
                        setOngkirTiers(newTiers);
                      }}
                      className="w-full p-2 bg-slate-950 border border-white/5 rounded-lg text-xs text-white"
                    />
                  </div>
                  <div className="flex space-x-2">
                    <button
                      onClick={() => {
                        setOngkirTiers(ongkirTiers.filter(t => t.id !== tier.id));
                      }}
                      className="p-2 w-full rounded bg-rose-500/10 border border-rose-500/20 text-rose-400 hover:bg-rose-500 hover:text-white transition flex justify-center items-center"
                      title="Hapus Tier"
                    >
                      <Trash size={12} />
                    </button>
                  </div>
                </div>
              ))}

              <div className="pt-2 flex justify-between">
                <button
                  onClick={() => {
                    setOngkirTiers([...ongkirTiers, { id: Date.now(), maxDist: 20, fee: 30000, promoDiscount: 5000 }]);
                  }}
                  className="px-3 py-1.5 bg-white/5 border border-white/5 rounded-lg text-[10px] font-bold text-slate-400 hover:text-white flex items-center space-x-1"
                >
                  <Plus size={10} />
                  <span>Add Tier</span>
                </button>

                <button
                  onClick={handleSaveOngkirTiers}
                  className="px-4 py-1.5 bg-pink-500 hover:bg-pink-600 text-white rounded-lg text-[10px] font-bold transition flex items-center space-x-1"
                >
                  <Check size={10} />
                  <span>Save Tiers</span>
                </button>
              </div>
            </div>
          </div>

          {/* Broadcast & Quiet Hours with Alert Banner */}
          <div className="glass-panel border border-white/5 rounded-2xl p-6 space-y-6">
            
            {/* Out of scope Alert banner */}
            <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-start space-x-3 text-xs">
              <AlertTriangle className="flex-shrink-0 mt-0.5" size={16} />
              <div>
                <p className="font-bold">Broadcast & Quiet Hours Engine</p>
                <p className="mt-0.5 text-[10px] text-amber-500/80">
                  ⚠️ **PEMBERITAHUAN:** Fitur backend Tier 3 belum aktif. Tampilan di bawah ini bersifat mockup UI mandiri.
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="text-base font-bold text-white flex items-center space-x-2">
                <Volume2 className="text-pink-400" />
                <span>Broadcast message editor</span>
              </h3>

              <div className="space-y-1.5">
                <label className="text-xs text-slate-400">Broadcast Teks</label>
                <textarea
                  rows={3}
                  value={broadcastText}
                  onChange={(e) => setBroadcastText(e.target.value)}
                  placeholder="Kirim promo bulanan Kala Spa ke pelanggan loyal..."
                  className="w-full p-3 bg-slate-950 border border-white/5 rounded-xl text-xs text-white resize-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs text-slate-400">Random delay interval (sec)</label>
                  <input
                    type="number"
                    value={randomDelay}
                    onChange={(e) => setRandomDelay(parseInt(e.target.value))}
                    className="w-full p-2 bg-slate-950 border border-white/5 rounded-xl text-xs text-white"
                  />
                </div>
                
                <div className="space-y-1.5">
                  <label className="text-xs text-slate-400">Quiet Hours (Start - End)</label>
                  <div className="flex space-x-2 items-center">
                    <input
                      type="text"
                      value={quietHoursStart}
                      onChange={(e) => setQuietHoursStart(e.target.value)}
                      className="w-full p-2 bg-slate-950 border border-white/5 rounded-xl text-xs text-white text-center"
                    />
                    <span className="text-slate-500">-</span>
                    <input
                      type="text"
                      value={quietHoursEnd}
                      onChange={(e) => setQuietHoursEnd(e.target.value)}
                      className="w-full p-2 bg-slate-950 border border-white/5 rounded-xl text-xs text-white text-center"
                    />
                  </div>
                </div>
              </div>

              <button
                disabled
                className="w-full py-2 bg-white/5 border border-white/5 text-slate-500 rounded-xl text-xs font-semibold cursor-not-allowed flex items-center justify-center space-x-1"
                title="Menunggu backend Tier 3"
              >
                <span>Queue Broadcast Campaign (Waiting Backend Tier 3)</span>
              </button>
            </div>

          </div>

        </div>

      </div>
    </div>
  );
};
