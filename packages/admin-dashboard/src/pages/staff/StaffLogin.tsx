import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStaffAuth } from '../../contexts/StaffAuthContext';
import { Lock, Phone, AlertTriangle, HeartHandshake } from 'lucide-react';
import { BRAND } from '../../config/brand';

export const StaffLogin: React.FC = () => {
  const { login } = useStaffAuth();
  const navigate = useNavigate();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await login(phone, password);
      navigate('/admin/staff/today', { replace: true });
    } catch (err: any) {
      setError(err.message || 'Login gagal. Periksa nomor HP dan password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-[#f0f2f5] flex flex-col justify-center items-center p-4 relative">
      {/* Main card */}
      <div className="w-full max-w-md bg-white rounded-2xl p-6 sm:p-8 border border-[#e9edef] relative z-10 shadow-sm">
        {/* Brand Header */}
        <div className="text-center mb-6">
          <div className="inline-flex h-14 w-14 rounded-2xl bg-[#008069] items-center justify-center text-white shadow-xs mb-3">
            <HeartHandshake size={28} />
          </div>
          <h2 className="text-xl font-bold tracking-tight text-[#111b21] mb-1">
            {BRAND.businessName}
          </h2>
          <p className="text-xs text-[#008069] font-bold uppercase tracking-wider">
            Portal Terapis & Staff Lapangan
          </p>
          <p className="text-xs text-[#667781] mt-1">
            Masuk untuk melihat jadwal tugas & percakapan hari ini
          </p>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="mb-5 flex items-start space-x-3 p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs">
            <AlertTriangle className="flex-shrink-0 mt-0.5" size={16} />
            <span>{error}</span>
          </div>
        )}

        {/* Login Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Phone input */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-[#111b21]">Nomor WhatsApp / HP</label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-[#8696a0]">
                <Phone size={16} />
              </span>
              <input
                type="tel"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="08123456789"
                className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-white border border-[#d1d7db] text-[#111b21] placeholder-[#8696a0] text-sm focus:outline-none focus:border-[#008069] focus:ring-2 focus:ring-[#008069]/15 transition-all"
              />
            </div>
          </div>

          {/* Password input */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-[#111b21]">Password</label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-[#8696a0]">
                <Lock size={16} />
              </span>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-white border border-[#d1d7db] text-[#111b21] placeholder-[#8696a0] text-sm focus:outline-none focus:border-[#008069] focus:ring-2 focus:ring-[#008069]/15 transition-all"
              />
            </div>
          </div>

          {/* Submit button */}
          <button
            type="submit"
            disabled={loading}
            className="w-full min-h-[44px] py-2.5 px-4 rounded-xl text-white font-semibold text-sm bg-[#008069] hover:bg-[#00a884] shadow-xs flex items-center justify-center space-x-2 transition-colors disabled:opacity-50 mt-2"
          >
            {loading ? (
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
            ) : (
              <span>Masuk ke Portal</span>
            )}
          </button>
        </form>
      </div>
    </div>
  );
};
