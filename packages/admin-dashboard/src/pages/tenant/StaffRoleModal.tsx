/**
 * Modal tambah/edit role dan hak akses modul. Presentasi murni: state form dan
 * penyimpanan tetap di halaman induk.
 */
import React from 'react';
import { ArrowDown, ArrowUp, CheckSquare, Compass, ListOrdered, ShieldCheck } from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { FormErrorSummary } from '../../components/ui/FormErrorSummary';
import { ALL_MODULES } from '../../config/rolePermissions';

interface StaffRoleModalProps {
  mode: 'CREATE' | 'EDIT';
  roleKey: string;
  label: string;
  description: string;
  defaultRedirect: string;
  allowedPaths: string[];
  formIssues: any[];
  moduleCategories: Array<{ category: string; modules: typeof ALL_MODULES }>;
  onClose: () => void;
  onSave: (e: React.FormEvent) => void;
  onKeyChange: (value: string) => void;
  onLabelChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onDefaultRedirectChange: (value: string) => void;
  onAllowedPathsChange: (paths: string[]) => void;
}

export const StaffRoleModal: React.FC<StaffRoleModalProps> = ({
  mode,
  roleKey,
  label,
  description,
  defaultRedirect,
  allowedPaths,
  formIssues,
  moduleCategories,
  onClose,
  onSave,
  onKeyChange,
  onLabelChange,
  onDescriptionChange,
  onDefaultRedirectChange,
  onAllowedPathsChange,
}) => {
  return (
  <Modal
    open
    onClose={() => onClose()}
    size="xl"
    bodyClassName="p-0 overflow-hidden flex-1 flex flex-col min-h-0"
    title={
      <span className="flex items-center gap-2">
        <ShieldCheck className="text-accent" size={19} aria-hidden="true" />
        <span>
          {mode === 'CREATE'
            ? 'Tambah Role & Setup Hak Akses Baru'
            : `Edit Hak Akses Role: ${label}`}
        </span>
      </span>
    }
  >

      <form onSubmit={onSave} className="space-y-4 overflow-y-auto flex-1 pr-1">
        <FormErrorSummary issues={formIssues} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          <div className="space-y-1">
            <label htmlFor="role-label" className="text-xs font-bold text-ink">Nama Role</label>
            <input
              id="role-label"
              type="text"
              required
              value={label}
              onChange={(e) => {
                onLabelChange(e.target.value);
                if (mode === 'CREATE') {
                  onKeyChange(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'));
                }
              }}
              placeholder="Contoh: Supervisor Cabang / Finance"
              className="w-full px-3.5 py-2 rounded-xl bg-surface border border-divider text-ink text-xs focus:outline-none focus:border-accent shadow-xs"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="role-key" className="text-xs font-bold text-ink">
              Key Identifier (Slug Sistem)
            </label>
            <input
              id="role-key"
              type="text"
              required
              disabled={mode === 'EDIT'}
              value={roleKey}
              onChange={(e) => onKeyChange(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))}
              placeholder="supervisor_cabang"
              className="w-full px-3.5 py-2 rounded-xl bg-fill-1 border border-divider font-mono text-ink text-xs focus:outline-none focus:border-accent disabled:opacity-70 shadow-xs"
            />
          </div>
        </div>

        <div className="space-y-1">
          <label htmlFor="role-description" className="text-xs font-bold text-ink">Deskripsi Singkat Tanggung Jawab</label>
          <input
            id="role-description"
            type="text"
            value={description}
            onChange={(e) => onDescriptionChange(e.target.value)}
            placeholder="Contoh: Mengawasi operasional harian, reservasi kalender, dan laporan CS"
            className="w-full px-3.5 py-2 rounded-xl bg-surface border border-divider text-ink text-xs focus:outline-none focus:border-accent shadow-xs"
          />
        </div>

        {/* Module Checkbox Selector */}
        <div className="space-y-2 pt-2 border-t border-divider">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-ink flex items-center space-x-1.5">
              <CheckSquare size={14} className="text-accent" />
              <span>Pilih Izin Modul & Menu Dashboard ({allowedPaths.length} Terpilih)</span>
            </span>

            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={() => onAllowedPathsChange(ALL_MODULES.map((m) => m.path))}
                className="text-[11px] text-accent hover:underline font-bold"
              >
                Pilih Semua (19)
              </button>
              <span className="text-strong">|</span>
              <button
                type="button"
                onClick={() => onAllowedPathsChange([])}
                className="text-[11px] text-danger hover:underline font-bold"
              >
                Hapus Semua
              </button>
            </div>
          </div>

          <div className="space-y-3 max-h-72 overflow-y-auto p-3 bg-surface-2 rounded-xl border border-divider">
            {moduleCategories.map((group) => (
              <div key={group.category} className="space-y-1.5">
                <div className="text-[11px] font-bold text-accent uppercase tracking-wider border-b border-divider pb-1 flex items-center justify-between">
                  <span>{group.category}</span>
                  <button
                    type="button"
                    onClick={() => {
                      const groupPaths = group.modules.map((m) => m.path);
                      const allIn = groupPaths.every((p) => allowedPaths.includes(p));
                      if (allIn) {
                        onAllowedPathsChange(allowedPaths.filter((p) => !groupPaths.includes(p)));
                      } else {
                        const set = new Set([...allowedPaths, ...groupPaths]);
                        onAllowedPathsChange(Array.from(set));
                      }
                    }}
                    className="text-[10px] text-ink-3 hover:text-accent normal-case"
                  >
                    Toggle Kategori
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                  {group.modules.map((mod) => {
                    const isChecked = allowedPaths.includes(mod.path);
                    return (
                      <label
                        key={mod.id}
                        htmlFor={`role-mod-${mod.id}`}
                        className={`flex items-start space-x-2.5 p-2 rounded-xl border cursor-pointer transition ${
                          isChecked
                            ? 'bg-accent-soft border-accent/30 text-ink'
                            : 'bg-surface border-divider text-ink-2 hover:bg-fill-1'
                        }`}
                      >
                        <input
                          id={`role-mod-${mod.id}`}
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              onAllowedPathsChange([...allowedPaths, mod.path]);
                            } else {
                              onAllowedPathsChange(
                                allowedPaths.filter((p) => p !== mod.path)
                              );
                            }
                          }}
                          className="mt-0.5 h-4 w-4 rounded text-accent focus:ring-accent"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold leading-tight">{mod.name}</p>
                          <p className="text-[10px] text-ink-3 truncate">{mod.description}</p>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Landing Page Selector */}
        <div className="space-y-1.5 pt-2 border-t border-divider">
          <label htmlFor="role-default-redirect" className="text-xs font-bold text-ink flex items-center space-x-1.5">
            <Compass size={14} className="text-accent" />
            <span>Halaman Awal Masuk Setelah Login (Landing Page)</span>
          </label>
          <p className="text-[11px] text-ink-3">
            Pilih menu utama yang langsung dibuka otomatis ketika staf dengan peran ini masuk ke dashboard.
          </p>
          <select
            id="role-default-redirect"
            value={defaultRedirect}
            onChange={(e) => onDefaultRedirectChange(e.target.value)}
            className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-divider text-ink text-xs focus:outline-none focus:border-accent shadow-xs font-medium"
          >
            {allowedPaths.map((p) => {
              const mod = ALL_MODULES.find((m) => m.path === p);
              return (
                <option key={p} value={p}>
                  {mod ? `${mod.name} (${p})` : p}
                </option>
              );
            })}
            {!allowedPaths.includes(defaultRedirect) && (
              <option value={defaultRedirect}>
                {defaultRedirect} (Kustom)
              </option>
            )}
          </select>
        </div>

        {/* Sidebar Menu Sequence / Order Selector */}
        {allowedPaths.length > 0 && (
          <div className="space-y-2 pt-2 border-t border-divider">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-ink flex items-center space-x-1.5">
                <ListOrdered size={14} className="text-accent" />
                <span>Urutan Menu di Sidebar ({allowedPaths.length} Menu)</span>
              </span>
              <span className="text-[10px] text-ink-3">
                Klik ▲ atau ▼ untuk memindahkan urutan
              </span>
            </div>

            <div className="space-y-1 max-h-48 overflow-y-auto p-2 bg-surface-2 rounded-xl border border-divider">
              {allowedPaths.map((p, idx) => {
                const mod = ALL_MODULES.find((m) => m.path === p);
                const isLanding = defaultRedirect === p;

                const moveUp = (e: React.MouseEvent) => {
                  e.preventDefault();
                  if (idx === 0) return;
                  const copy = [...allowedPaths];
                  const temp = copy[idx - 1];
                  copy[idx - 1] = copy[idx];
                  copy[idx] = temp;
                  onAllowedPathsChange(copy);
                };

                const moveDown = (e: React.MouseEvent) => {
                  e.preventDefault();
                  if (idx === allowedPaths.length - 1) return;
                  const copy = [...allowedPaths];
                  const temp = copy[idx + 1];
                  copy[idx + 1] = copy[idx];
                  copy[idx] = temp;
                  onAllowedPathsChange(copy);
                };

                return (
                  <div
                    key={p}
                    className={`flex items-center justify-between px-3 py-1.5 rounded-lg border transition-colors ${
                      isLanding
                        ? 'bg-accent-soft border-accent/40 text-ink'
                        : 'bg-surface border-divider text-ink-2'
                    }`}
                  >
                    <div className="flex items-center space-x-2 min-w-0">
                      <span className="h-5 w-5 rounded-md bg-fill-1 text-ink flex items-center justify-center text-[10px] font-bold">
                        #{idx + 1}
                      </span>
                      <span className="text-xs font-semibold truncate">
                        {mod?.name || p}
                      </span>
                      {isLanding && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-accent text-accent-ink">
                          Landing Page
                        </span>
                      )}
                    </div>

                    <div className="flex items-center space-x-1">
                      <button
                        aria-label="Pindah ke Atas"
                        type="button"
                        disabled={idx === 0}
                        onClick={moveUp}
                        title="Pindah ke Atas"
                        className="p-1 rounded-md text-ink-2 hover:bg-fill-2 hover:text-ink disabled:opacity-30"
                      >
                        <ArrowUp size={13} />
                      </button>
                      <button
                        aria-label="Pindah ke Bawah"
                        type="button"
                        disabled={idx === allowedPaths.length - 1}
                        onClick={moveDown}
                        title="Pindah ke Bawah"
                        className="p-1 rounded-md text-ink-2 hover:bg-fill-2 hover:text-ink disabled:opacity-30"
                      >
                        <ArrowDown size={13} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="pt-3 border-t border-divider flex items-center justify-end space-x-2 flex-shrink-0">
          <button
            type="button"
            onClick={() => onClose()}
            className="px-4 py-2 rounded-xl text-ink-2 hover:bg-fill-1 text-xs font-semibold transition-colors"
          >
            Batal
          </button>
          <button
            type="submit"
            className="px-5 py-2 rounded-xl bg-accent hover:bg-accent-hover text-accent-ink font-bold text-xs shadow-xs transition active:scale-95"
          >
            Simpan Konfigurasi Role
          </button>
        </div>
      </form>
  </Modal>
  );
};
