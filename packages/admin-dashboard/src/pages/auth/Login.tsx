import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { Lock, User, AlertTriangle } from 'lucide-react';
import { BRAND } from '../../config/brand';

export const Login: React.FC = () => {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const result = await login(identifier, password);
      navigate(result.redirectTo || '/admin/overview', { replace: true });
    } catch (err: any) {
      setError(err.message || 'Login gagal. Periksa kembali email/nomor WhatsApp dan password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-[#f0f2f5] flex flex-col justify-center items-center p-4 relative">
      {/* Main card */}
      <div className="w-full max-w-md bg-white rounded-2xl p-8 border border-[#e9edef] relative z-10 shadow-sm">
        {/* Brand Header */}
        <div className="text-center mb-8">
          <div className="inline-flex h-14 w-14 rounded-2xl bg-[#008069] items-center justify-center font-black text-2xl text-white shadow-xs mb-3.5">
            {BRAND.initial}
          </div>
          <h2 className="text-xl font-bold tracking-tight text-[#111b21] mb-1">
            {BRAND.businessName}
          </h2>
          <p className="text-xs text-[#667781]">
            Masuk ke portal sistem & layanan klinik
          </p>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="mb-6 flex items-start space-x-3 p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs">
            <AlertTriangle className="flex-shrink-0 mt-0.5" size={16} />
            <span>{error}</span>
          </div>
        )}

        {/* Login Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Identifier input (Email / No HP WhatsApp) */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-[#111b21]">
              Email Admin / No. WhatsApp Staff
            </label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-[#8696a0]">
                <User size={16} />
              </span>
              <input
                type="text"
                required
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="admin@email.com atau 08123456789"
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

          {/* Action button */}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 px-4 rounded-xl text-white font-semibold text-sm bg-[#008069] hover:bg-[#00a884] shadow-xs flex items-center justify-center space-x-2 disabled:opacity-50 transition-colors mt-2"
          >
            {loading ? (
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
            ) : (
              <span>Masuk Sekarang</span>
            )}
          </button>
        </form>
      </div>
    </div>
  );
};
