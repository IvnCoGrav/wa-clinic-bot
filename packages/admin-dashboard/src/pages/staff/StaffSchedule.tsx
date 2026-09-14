import React from 'react';
import { StaffToday } from './StaffToday';

/**
 * StaffSchedule.tsx
 * Proxy konsolidasi menuju portal terpadu StaffToday dengan tab "upcoming" (Jadwal Mendatang).
 * Mengeliminasi duplikasi kode 630 baris dan menjaga konsistensi fitur real-time.
 */
export const StaffSchedule: React.FC = () => {
  return <StaffToday defaultTab="upcoming" />;
};

export default StaffSchedule;
