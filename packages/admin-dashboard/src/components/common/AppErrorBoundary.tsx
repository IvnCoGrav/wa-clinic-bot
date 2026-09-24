import React from 'react';

interface Props {
  children: React.ReactNode;
  scopeLabel?: string;
}

interface State {
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

const CHUNK_RE = /Failed to fetch dynamically imported module|ChunkLoadError|dynamically imported module/i;

export class AppErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, errorInfo: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    this.setState({ errorInfo });
    const msg = error?.message || '';
    if (CHUNK_RE.test(msg)) {
      try {
        if (!sessionStorage.getItem('chunk_reload_attempt')) {
          sessionStorage.setItem('chunk_reload_attempt', '1');
          // Bersihkan cache API (apiCache:*) + CacheStorage agar chunk hash lama tidak tersaji
          for (let i = sessionStorage.length - 1; i >= 0; i--) {
            const k = sessionStorage.key(i);
            if (k && k.startsWith('apiCache:')) sessionStorage.removeItem(k);
          }
          const w = window as any;
          if (w.caches && typeof w.caches.keys === 'function') {
            w.caches.keys().then((keys: string[]) => Promise.all(keys.map((k: string) => w.caches.delete(k)))).finally(() => window.location.reload());
            return;
          }
          window.location.reload();
          return;
        }
      } catch {
        // fallback ke UI error di bawah
      }
    }
  }

  handleReload = () => {
    try {
      sessionStorage.removeItem('chunk_reload_attempt');
    } catch {}
    window.location.reload();
  };

  handleGoDashboard = () => {
    try {
      sessionStorage.removeItem('chunk_reload_attempt');
    } catch {}
    window.location.href = '/admin/overview';
  };

  handleReset = () => {
    this.setState({ error: null, errorInfo: null });
  };

  render() {
    if (!this.state.error) return this.props.children;

    const isChunk = CHUNK_RE.test(this.state.error.message || '');
    return (
      <div className="min-h-[60vh] flex items-center justify-center bg-[#f0f2f5] dark:bg-[#111b21] p-6">
        <div className="bg-white dark:bg-[#202c33] border border-[#e9edef] dark:border-[#2a3942] rounded-2xl p-6 sm:p-8 shadow-xs max-w-lg w-full flex flex-col items-center text-center gap-4">
          <div className="w-12 h-12 rounded-full bg-amber-50 dark:bg-amber-500/15 border border-amber-200 dark:border-amber-500/30 flex items-center justify-center text-amber-600 dark:text-amber-300 text-xl">
            ⚠️
          </div>
          <h2 className="text-base font-extrabold text-[#111b21] dark:text-[#e9edef]">Terjadi Kendala Memuat Halaman</h2>
          <p className="text-xs text-[#667781] dark:text-[#8696a0] leading-relaxed">
            {isChunk
              ? 'Versi aplikasi baru saja diperbarui. Halaman gagal memuat bundle lama. Silakan muat ulang.'
              : 'Terjadi kesalahan tak terduga saat merender halaman. Coba muat ulang atau kembali ke dashboard.'}
            {this.props.scopeLabel ? ` [${this.props.scopeLabel}]` : ''}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2 w-full">
            <button
              onClick={this.handleReload}
              className="px-4 py-2 bg-[#008069] hover:bg-[#00a884] rounded-xl text-xs font-bold text-white transition shadow-xs"
            >
              Muat Ulang Halaman
            </button>
            <button
              onClick={this.handleGoDashboard}
              className="px-4 py-2 bg-white dark:bg-transparent border border-[#d1d7db] dark:border-[#374248] hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942] rounded-xl text-xs font-bold text-[#111b21] dark:text-[#e9edef] transition shadow-xs"
            >
              Kembali ke Dashboard Utama
            </button>
            <button
              onClick={this.handleReset}
              className="px-3 py-2 text-xs font-semibold text-[#667781] dark:text-[#aebac1] hover:text-[#111b21] dark:hover:text-[#e9edef] transition"
            >
              Coba Lagi
            </button>
          </div>
          <details className="w-full text-left bg-[#f8fafc] dark:bg-[#111b21] border border-[#e9edef] dark:border-[#2a3942] rounded-xl p-3">
            <summary className="text-xs font-bold text-[#54656f] dark:text-[#aebac1] cursor-pointer">Detail teknis (untuk staf IT)</summary>
            <pre className="mt-2 text-[11px] font-mono text-rose-700 dark:text-rose-300 whitespace-pre-wrap break-all max-h-48 overflow-auto">
              {this.state.error.message}
              {this.state.error.stack ? `\n\n${this.state.error.stack}` : ''}
              {this.state.errorInfo?.componentStack ? `\n\nComponent stack:${this.state.errorInfo.componentStack}` : ''}
            </pre>
          </details>
        </div>
      </div>
    );
  }
}

export default AppErrorBoundary;
