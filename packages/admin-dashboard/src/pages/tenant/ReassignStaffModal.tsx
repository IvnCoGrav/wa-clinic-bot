/**
 * Modal delegasi atau ganti terapis untuk satu jadwal treatment.
 */
import React from 'react';
import { UserCheck } from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { TreatmentTask } from './todayTreatmentsTypes';
import { formatTime } from './todayTreatmentsLogic';

interface ReassignStaffModalProps {
  task: TreatmentTask;
  staffId: string;
  teamMembers: Array<{ id: string; name: string; role?: string }>;
  submitting: boolean;
  onClose: () => void;
  onStaffChange: (staffId: string) => void;
  onSubmit: (e: React.FormEvent) => void;
}

export const ReassignStaffModal: React.FC<ReassignStaffModalProps> = ({
  task,
  staffId,
  teamMembers,
  submitting,
  onClose,
  onStaffChange,
  onSubmit,
}) => (
  <Modal
    open
    onClose={onClose}
    size="md"
    title={
      <span className="flex items-center gap-2">
        <UserCheck size={20} className="text-violet" aria-hidden="true" />
        <span>{task.assignedStaff ? 'Ganti Terapis Jadwal' : 'Delegasikan Jadwal'}</span>
      </span>
    }
    subtitle={task.customerName || 'Pasien'}
  >
    <form onSubmit={onSubmit} className="flex-1 overflow-y-auto p-5 space-y-4 text-left overscroll-contain">
      <div className="p-3.5 bg-surface-2 dark:bg-surface-2 rounded-2xl border border-divider space-y-1.5 text-xs">
        <p className="text-ink-2">
          Jam Kunjungan: <span className="font-bold text-ink">{formatTime(task.bookingDate)}</span>
        </p>
        <p className="text-ink-2">
          Treatment: <span className="font-bold text-ink">{task.treatmentDetail}</span>
        </p>
        <p className="text-ink-2">
          Terapis Saat Ini:{' '}
          <span className="font-bold text-purple-700 dark:text-ink-2">
            {task.assignedStaff?.name || 'Belum Ditugaskan'}
          </span>
        </p>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="reassign-staff" className="block text-xs font-bold text-ink">
          Pilih Terapis Pengganti:
        </label>
        <select
          id="reassign-staff"
          value={staffId}
          onChange={(e) => onStaffChange(e.target.value)}
          className="w-full bg-surface border border-divider rounded-xl p-3 text-xs text-ink font-semibold focus:outline-none focus:border-accent shadow-xs"
        >
          <option value="">-- Pilih Staf Terapis --</option>
          {teamMembers.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} ({m.role || 'Staff'})
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center justify-end space-x-2 pt-3 border-t border-divider">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2.5 rounded-xl border border-divider text-xs font-semibold text-ink-2 hover:bg-fill-1 transition cursor-pointer"
        >
          Batal
        </button>
        <button
          type="submit"
          disabled={submitting || !staffId}
          className="px-5 py-2.5 rounded-xl bg-accent hover:bg-accent-hover text-accent-ink text-xs font-bold transition flex items-center space-x-1.5 shadow-xs disabled:opacity-50 cursor-pointer"
        >
          {submitting ? (
            <span>Menyimpan...</span>
          ) : (
            <span>{task.assignedStaff ? 'Simpan Ganti Terapis' : 'Simpan Delegasi'}</span>
          )}
        </button>
      </div>
    </form>
  </Modal>
);
