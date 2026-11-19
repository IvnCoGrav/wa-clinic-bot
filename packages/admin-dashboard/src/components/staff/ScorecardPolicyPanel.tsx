import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Info, Save, Scale } from 'lucide-react';
import { apiRequest } from '../../services/api';
import { useUiFeedback } from '../common/UiFeedback';
import { Button } from '../ui/Button';
import { Input } from '../ui/Fields';

interface ScorecardPolicy {
  id?: string;
  weight_punctuality: number;
  weight_retention: number;
  weight_volume: number;
  tolerance_minutes: number;
  chat_evidence_minutes: number;
  target_visits_per_day: number;
  working_days_per_month: number;
  min_sample_punctuality: number;
  min_sample_retention: number;
  min_tenure_months: number;
  grade_a_min: number;
  grade_b_min: number;
  grade_c_min: number;
  grade_d_min: number;
  formula_version: string;
  effective_from: string | Date;
  is_fallback?: boolean;
}

interface RetentionPolicyReference {
  benchmark_pct?: number;
  min_sample?: number;
  min_tenure_months?: number;
  window_days?: number;
  formula_version?: string;
}

const FALLBACK: ScorecardPolicy = {
  weight_punctuality: 50,
  weight_retention: 30,
  weight_volume: 20,
  tolerance_minutes: 30,
  chat_evidence_minutes: 30,
  target_visits_per_day: 3,
  working_days_per_month: 26,
  min_sample_punctuality: 10,
  min_sample_retention: 40,
  min_tenure_months: 4,
  grade_a_min: 90,
  grade_b_min: 75,
  grade_c_min: 60,
  grade_d_min: 40,
  formula_version: 'v1',
  effective_from: new Date().toISOString(),
};

function toDateInput(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
  }
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(date);
}

export const ScorecardPolicyPanel: React.FC = () => {
  const { toast, confirm } = useUiFeedback();
  const [policy, setPolicy] = useState<ScorecardPolicy>(FALLBACK);
  const [retention, setRetention] = useState<RetentionPolicyReference | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const [scorecardRes, retentionRes] = await Promise.all([
          apiRequest('/api/admin/staff-scorecard/policy'),
          apiRequest('/api/admin/staff-retention/policy').catch(() => null),
        ]);

        if (!active) return;

        if (scorecardRes?.success && scorecardRes.data) {
          setPolicy({ ...FALLBACK, ...scorecardRes.data });
        } else {
          setError('Gagal memuat policy penilaian.');
        }

        if (retentionRes?.success && retentionRes.data) {
          setRetention(retentionRes.data);
        }
      } catch (err: any) {
        if (active) setError(err?.message || 'Gagal memuat policy penilaian.');
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  const weightsTotal = useMemo(
    () => policy.weight_punctuality + policy.weight_retention + policy.weight_volume,
    [policy.weight_punctuality, policy.weight_retention, policy.weight_volume]
  );

  const gradeOrderValid =
    policy.grade_a_min > policy.grade_b_min &&
    policy.grade_b_min > policy.grade_c_min &&
    policy.grade_c_min > policy.grade_d_min;

  const canSave = weightsTotal === 100 && gradeOrderValid && !saving;

  const update = (key: keyof ScorecardPolicy, value: string | number) => {
    setPolicy((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    if (weightsTotal !== 100) {
      toast('Total bobot harus tepat 100 sebelum disimpan.', 'error');
      return;
    }
    if (!gradeOrderValid) {
      toast('Ambang grade harus menurun: A > B > C > D.', 'error');
      return;
    }

    const confirmed = await confirm({
      title: 'Simpan Policy Penilaian',
      message:
        'Policy baru berlaku untuk perhitungan berikutnya. Snapshot periode yang sudah FINAL tidak berubah.',
      confirmText: 'Simpan',
      cancelText: 'Batal',
    });
    if (!confirmed) return;

    setSaving(true);
    try {
      const res = await apiRequest('/api/admin/staff-scorecard/policy', {
        method: 'PUT',
        body: JSON.stringify({
          ...policy,
          effective_from: policy.effective_from,
        }),
      });
      if (res?.success) {
        setPolicy({ ...FALLBACK, ...res.data });
        toast('Policy penilaian tersimpan.', 'success');
      } else {
        toast(res?.error || 'Gagal menyimpan policy.', 'error');
      }
    } catch (err: any) {
      toast(err?.message || 'Gagal menyimpan policy.', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-surface border border-divider rounded-2xl p-6 text-xs text-ink-3">
        Memuat policy penilaian…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-surface border border-divider rounded-2xl p-5 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-xl bg-accent/10 text-accent">
              <Scale size={20} />
            </div>
            <div>
              <h2 className="text-base font-bold text-ink">Policy Penilaian Bidan</h2>
              <p className="text-xs text-ink-3 mt-0.5">
                Bobot, ambang, dan target yang dipakai dashboard bidan. Setiap perubahan disimpan
                sebagai versi baru dan tercatat di audit log.
              </p>
            </div>
          </div>
          <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-fill-1 text-ink-2 border border-divider">
            {policy.formula_version || 'v1'}
            {policy.is_fallback ? ' · default' : ''}
          </span>
        </div>

        {retention && (
          <div className="mt-4 flex items-start gap-2 p-3 rounded-xl bg-fill-1 border border-divider text-[11px] text-ink-2">
            <Info size={14} className="text-accent mt-0.5 flex-shrink-0" />
            <p>
              Retensi mengikuti policy kanonis: benchmark <b>{retention.benchmark_pct ?? '-'}%</b>,
              sampel minimum <b>{retention.min_sample ?? '-'}</b>, masa kerja minimum{' '}
              <b>{retention.min_tenure_months ?? '-'} bulan</b>
              {retention.window_days ? `, jendela ${retention.window_days} hari` : ''}. Nilainya
              tidak diatur di halaman ini.
            </p>
          </div>
        )}

        {error && (
          <div className="mt-4 flex items-start gap-2 p-3 rounded-xl bg-danger-soft border border-danger-line text-[11px] text-danger">
            <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="bg-surface border border-divider rounded-2xl p-5 shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-ink">Bobot Komponen</h3>
            <span
              className={`text-[11px] font-bold ${
                weightsTotal === 100 ? 'text-success' : 'text-danger'
              }`}
            >
              Total {weightsTotal}%
            </span>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Input
              label="Ketepatan"
              type="number"
              min={0}
              max={100}
              value={policy.weight_punctuality}
              onChange={(e) => update('weight_punctuality', Number(e.target.value))}
            />
            <Input
              label="Retensi"
              type="number"
              min={0}
              max={100}
              value={policy.weight_retention}
              onChange={(e) => update('weight_retention', Number(e.target.value))}
            />
            <Input
              label="Kunjungan"
              type="number"
              min={0}
              max={100}
              value={policy.weight_volume}
              onChange={(e) => update('weight_volume', Number(e.target.value))}
            />
          </div>
          <p className="text-[11px] text-ink-3">
            Total harus tepat 100. Komponen yang sampelnya kurang otomatis dikeluarkan dan
            bobotnya dinormalisasi.
          </p>
        </section>

        <section className="bg-surface border border-divider rounded-2xl p-5 shadow-xs space-y-3">
          <h3 className="text-sm font-bold text-ink">Waktu</h3>
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Toleransi terlambat (menit)"
              type="number"
              min={0}
              max={180}
              value={policy.tolerance_minutes}
              onChange={(e) => update('tolerance_minutes', Number(e.target.value))}
            />
            <Input
              label="Ambang bukti chat (menit)"
              type="number"
              min={0}
              max={180}
              value={policy.chat_evidence_minutes}
              onChange={(e) => update('chat_evidence_minutes', Number(e.target.value))}
            />
          </div>
          <p className="text-[11px] text-ink-3">
            Pesan customer setelah ambang ini menjadi kandidat keterlambatan dan wajib direview.
          </p>
        </section>

        <section className="bg-surface border border-divider rounded-2xl p-5 shadow-xs space-y-3">
          <h3 className="text-sm font-bold text-ink">Target Kunjungan</h3>
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Kunjungan per hari"
              type="number"
              min={1}
              max={20}
              value={policy.target_visits_per_day}
              onChange={(e) => update('target_visits_per_day', Number(e.target.value))}
            />
            <Input
              label="Hari kerja per bulan"
              type="number"
              min={1}
              max={31}
              value={policy.working_days_per_month}
              onChange={(e) => update('working_days_per_month', Number(e.target.value))}
            />
          </div>
          <p className="text-[11px] text-ink-3">
            Target periode diprorata: target/hari × hari kerja × (hari berjalan ÷ hari bulan).
          </p>
        </section>

        <section className="bg-surface border border-divider rounded-2xl p-5 shadow-xs space-y-3">
          <h3 className="text-sm font-bold text-ink">Sampel Minimum</h3>
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Ketepatan"
              type="number"
              min={1}
              max={1000}
              value={policy.min_sample_punctuality}
              onChange={(e) => update('min_sample_punctuality', Number(e.target.value))}
            />
            <Input
              label="Retensi (dari policy kanonis)"
              type="number"
              value={retention?.min_sample ?? policy.min_sample_retention}
              disabled
              hint="Tidak dapat diubah di sini"
            />
          </div>
        </section>

        <section className="bg-surface border border-divider rounded-2xl p-5 shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-ink">Ambang Grade</h3>
            {!gradeOrderValid && (
              <span className="text-[11px] font-bold text-danger">Urutan tidak valid</span>
            )}
          </div>
          <div className="grid grid-cols-4 gap-2">
            <Input
              label="A ≥"
              type="number"
              min={1}
              max={100}
              value={policy.grade_a_min}
              onChange={(e) => update('grade_a_min', Number(e.target.value))}
            />
            <Input
              label="B ≥"
              type="number"
              min={1}
              max={100}
              value={policy.grade_b_min}
              onChange={(e) => update('grade_b_min', Number(e.target.value))}
            />
            <Input
              label="C ≥"
              type="number"
              min={1}
              max={100}
              value={policy.grade_c_min}
              onChange={(e) => update('grade_c_min', Number(e.target.value))}
            />
            <Input
              label="D ≥"
              type="number"
              min={1}
              max={100}
              value={policy.grade_d_min}
              onChange={(e) => update('grade_d_min', Number(e.target.value))}
            />
          </div>
        </section>

        <section className="bg-surface border border-divider rounded-2xl p-5 shadow-xs space-y-3">
          <h3 className="text-sm font-bold text-ink">Berlaku Mulai</h3>
          <Input
            type="date"
            value={toDateInput(policy.effective_from)}
            onChange={(e) => update('effective_from', new Date(`${e.target.value}T00:00:00+07:00`).toISOString())}
            hint="Gunakan tanggal berbeda untuk versi baru bila tanggal ini sudah pernah disimpan. Policy lama tetap tersimpan untuk audit."
          />
        </section>
      </div>

      <div className="flex items-center justify-end gap-2 bg-surface border border-divider rounded-2xl p-4 shadow-xs">
        <Button
          variant="primary"
          icon={<Save size={15} />}
          loading={saving}
          disabled={!canSave}
          onClick={handleSave}
        >
          Simpan Policy
        </Button>
      </div>
    </div>
  );
};
