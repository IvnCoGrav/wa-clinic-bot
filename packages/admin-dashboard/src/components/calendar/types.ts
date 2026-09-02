import { Reservation } from '../../types';

export type CalendarViewMode = 'week' | 'day' | 'month' | 'table';

export interface CalendarFilterState {
  searchQuery: string;
  category: 'all' | 'BABY' | 'MOMS' | 'KIDS' | 'BOTH' | 'BUNDLE';
  staffId: string;
  status: 'all' | 'upcoming' | 'overdue' | 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'hold';
}

export interface ClinicServiceItem {
  id: string;
  name: string;
  category: 'BABY' | 'KIDS' | 'MOMS' | 'BOTH' | 'BUNDLE' | 'ADD_ON';
  serviceType?: 'STANDARD' | 'BUNDLE' | 'ADD_ON';
  bundleItemIds?: string[];
  isAddon?: boolean;
  ageTier?: {
    minAgeMonths: number;
    maxAgeMonths: number | null;
    label: string;
  };
  durationMinutes: number;
  originalPrice: number;
  promoPrice: number;
  description: string;
  isActive: boolean;
  totalSessions?: number;
  sessionScheduleType?: string;
}

export interface StaffOption {
  id: string;
  name: string;
  phone?: string;
  active?: boolean;
  role?: string;
}

export interface CustomerOption {
  id: string;
  name: string | null;
  phone: string;
  kelurahan?: string | null;
  kecamatan?: string | null;
  kota?: string | null;
  distance_km?: number | null;
  ongkir?: number | null;
  children?: Array<{
    id: string;
    name: string;
    birth_date: string | null;
    raw_age_text: string | null;
    current_age: string;
  }>;
}

export interface QuickSlotTarget {
  date: Date;
  hour: number;
}
