/**
 * Daftar tugas Mendatang, dikelompokkan per tanggal.
 *
 * Komponen presentasi murni: detail, edit lokasi, navigasi, pencarian, dan
 * pembesaran foto diteruskan ke halaman induk lewat callback.
 */
import React from 'react';
import {
  Baby,
  Camera,
  CheckCircle2,
  Clock,
  Compass,
  CreditCard,
  MapPin,
  Maximize2,
  Navigation,
  PenLine,
} from 'lucide-react';
import { formatRupiah } from '../../utils/money';
import { formatPatientName, formatChildAgeText } from '../../utils/staffDisplayFormat';
import { formatClinicalAge } from '../../utils/clinicalAge';
import { needsNavigationPreflight } from '../../utils/geoUtils';
import { StaffTask } from './staffTaskTypes';
import { AccuracyBadge, AddressUpdatedAtChip, getCategoryIcon } from './staffTaskDisplay';
import { formatTaskTime } from './staffTaskLogic';

interface StaffUpcomingCardProps {
  dateLabel: string;
  items: StaffTask[];
  onOpenDetail: (task: StaffTask) => void;
  onEditLocation: (task: StaffTask) => void;
  onNavigate: (task: StaffTask, e?: React.MouseEvent) => void;
  onSearchQuery: (query: string) => void;
  onShowImage: (kind: 'house', url: string | null) => void;
}

export const StaffUpcomingCard: React.FC<StaffUpcomingCardProps> = ({
  dateLabel,
  items,
  onOpenDetail,
  onEditLocation,
  onNavigate,
  onSearchQuery,
  onShowImage,
}) => (

<div className="space-y-3">
{/* Date Header Pill */}
<div className="flex items-center space-x-2 pt-2">
  <span className="h-2.5 w-2.5 rounded-full bg-accent"></span>
  <h2 className="font-bold text-sm text-ink">{dateLabel}</h2>
  <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-surface text-ink-2 border border-divider">
    {items.length} Kunjungan
  </span>
</div>

{/* Cards Grid */}
<div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
  {items.map((item) => {
    const catInfo = getCategoryIcon(item.treatmentCategory);
    return (
      <div
        key={item.reservationId}
        className={`bg-surface rounded-2xl p-4 border border-divider dark:border-divider shadow-xs hover:border-accent/40 transition space-y-3 text-left ${catInfo.borderAccent} border-l-4`}
      >
        {/* Header: Name & Time (KLIK BARIS INI = DETAIL PASIEN) */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => onOpenDetail(item)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onOpenDetail(item);
            }
          }}
          className="flex items-start justify-between gap-2 p-1 -m-1 rounded-xl hover:bg-fill-1 transition cursor-pointer group"
          title="Klik untuk melihat detail lengkap pasien"
        >
          <div className="flex items-center space-x-2.5 min-w-0">
            {/* Service Category Icon */}
            <div
              className={`h-10 w-10 rounded-2xl flex items-center justify-center flex-shrink-0 border shadow-xs transition group-hover:scale-105 ${catInfo.bg}`}
            >
              {catInfo.icon}
            </div>
            <div className="min-w-0">
              <h3 className="font-bold text-sm text-ink truncate group-hover:text-accent transition">
                {item.customerName || 'Customer'}
              </h3>
              <p className="text-xs text-accent font-medium line-clamp-2">
                {item.treatmentDetail || 'Treatment Layanan Spa'}
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-1 text-xs font-semibold text-accent bg-bubble-out px-2.5 py-1 rounded-lg whitespace-nowrap border border-accent/30 flex-shrink-0">
            <Clock size={12} />
            <span>{formatTaskTime(item.bookingDate)}</span>
          </div>
        </div>

        {/* Alamat & Jarak dari Klinik */}
        <div className="text-xs text-ink-2 bg-surface-2 p-2.5 rounded-xl border border-divider dark:border-divider space-y-2">
          <div className="flex items-start gap-1.5">
            <MapPin size={14} className="text-accent mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-ink leading-snug">{item.address.fullText}</p>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <AccuracyBadge source={item.address.locationSource} />
                <AddressUpdatedAtChip updatedAt={item.address.addressUpdatedAt} />
              </div>
              {item.address.distanceKm != null && (
                <p className="text-[10px] font-semibold text-accent mt-1 flex items-center gap-1">
                  <Compass size={11} />
                  <span>
                    {item.address.distanceSource === 'PREVIOUS_PATIENT' && item.address.originName
                      ? `Jarak: ${item.address.distanceKm.toFixed(1)} km dari ${item.address.originName}`
                      : `Jarak: ${item.address.distanceKm.toFixed(1)} km dari klinik`}
                    {item.address.estimatedMinutes != null && (
                      <span className="text-ink-2 font-normal ml-1">
                        (±{item.address.estimatedMinutes} mnt perjalanan)
                      </span>
                    )}
                  </span>
                </p>
              )}
            </div>
          </div>

          {/* Foto Depan Rumah & Patokan Landmark */}
          {item.address.housePhotoUrl ? (
            <div className="flex items-center gap-2 p-1.5 rounded-lg bg-surface border border-divider">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onShowImage('house', item.address.housePhotoUrl || null);
                }}
                className="h-11 w-11 rounded-lg bg-fill-1 overflow-hidden flex-shrink-0 relative group cursor-pointer border border-divider"
                title="Klik untuk memperbesar foto rumah"
                aria-label="Perbesar foto rumah"
              >
                <img
                  src={item.address.housePhotoUrl}
                  alt="Foto Depan Rumah"
                  className="h-full w-full object-cover group-hover:scale-105 transition-transform"
                />
                <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white transition-opacity">
                  <Maximize2 size={12} />
                </div>
              </button>
              <div className="flex-1 min-w-0">
                <span className="text-[10px] font-bold text-accent uppercase tracking-wider block">
                  Foto Depan Rumah
                </span>
                {item.address.landmark ? (
                  <p className="text-[11px] text-ink truncate font-medium">
                    Patokan: {item.address.landmark}
                  </p>
                ) : (
                  <p className="text-[10px] text-ink-2 truncate">Panduan visual tersimpan</p>
                )}
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onEditLocation(item);
                }}
                className="p-1.5 text-xs text-accent hover:bg-accent-soft rounded-lg transition border border-divider flex-shrink-0"
                title="Perbarui titik lokasi / foto rumah"
              >
                <PenLine size={12} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onEditLocation(item);
              }}
              className="w-full flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg bg-surface hover:bg-accent-soft text-accent text-[11px] font-semibold border border-dashed border-accent/40 transition active:scale-95"
            >
              <Camera size={12} />
              <span>+ Update Titik Lokasi & Foto Rumah</span>
            </button>
          )}
        </div>

        {/* Data Pasien Bayi / Anak */}
        {item.children && item.children.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {item.children.map((child, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-bubble-out text-accent text-xs font-medium border border-accent/20"
              >
                <Baby size={12} />
                <span>{formatPatientName(child.name)}</span>
                {child.rawAgeText && (
                  <span className="text-ink-2">({formatChildAgeText(child.rawAgeText)})</span>
                )}
              </span>
            ))}
          </div>
        )}

        {/* Total Biaya & Peta Navigasi */}
        <div className="flex items-center justify-between pt-2 border-t border-divider">
          <div className="flex items-center gap-1 text-xs text-ink-2">
            <CreditCard size={13} className="text-accent" />
            <span>Biaya:</span>
            <strong className="text-ink ml-0.5">{formatRupiah(item.pricing.totalFee)}</strong>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-ink-2 bg-fill-1 px-2 py-0.5 rounded-md border border-divider hidden sm:inline">
              Chat aktif di hari-H
            </span>
            {item.navigationUrl || item.mapsUrl ? (
              <button
                type="button"
                onClick={(e) => onNavigate(item, e)}
                className="flex items-center space-x-1 py-1.5 px-3 text-xs font-semibold text-on-solid bg-accent hover:bg-accent-hover rounded-lg transition active:scale-95 shadow-xs"
                title="Buka Peta Google Maps"
              >
                <Navigation size={12} />
                <span>Peta Rute</span>
              </button>
            ) : (
              <span className="text-[11px] text-ink-2">Tanpa Peta</span>
            )}
          </div>
        </div>
      </div>
    );
  })}
</div>
</div>
);
