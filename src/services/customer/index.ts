import { LocationSource } from '@prisma/client';
import { DEFAULT_TENANT_ID } from '../../config/tenant';
import {
  memoryCustomers,
  isTestRuntime,
  toNumberOrNull,
  isPreciseGps,
  CustomerNameSource,
  CustomerGroundTruth,
} from './shared';
import * as crud from './customer-crud.service';
import * as addr from './customer-address.service';
import * as ltv from './customer-ltv.service';
import * as mql from './customer-mql.service';
import * as exp from './customer-export.service';
import {
  SavedCustomerAddress,
  UpsertSavedAddressInput,
} from '../../domain/customer-address';
import { StaffOwnershipView } from '../staff-ownership.service';

export {
  memoryCustomers,
  isTestRuntime,
  CustomerNameSource,
  CustomerGroundTruth,
};

export { computeCustomerLtv, recalculateCustomerLtv } from './customer-ltv.service';

export class CustomerService {
  public static toNumberOrNull = toNumberOrNull;
  public static isPreciseGps = isPreciseGps;

  public getMemoryCustomers(): Map<string, any> {
    return crud.getMemoryCustomers();
  }

  public clearCustomerMemory(phone: string): void {
    crud.clearCustomerMemory(phone);
  }

  public async setChatLabelFlag(
    phone: string,
    flag: 'is_admin_labeled' | 'is_hold_labeled',
    value: boolean
  ): Promise<void> {
    return crud.setChatLabelFlag(phone, flag, value);
  }

  public async markInternalStaffCustomer(
    phone: string,
    tenantId: string = DEFAULT_TENANT_ID
  ): Promise<void> {
    return crud.markInternalStaffCustomer(phone, tenantId);
  }

  public async setLabelFlags(
    phone: string,
    flags: { isAdminLabeled?: boolean; isHoldLabeled?: boolean },
    tenantId: string
  ): Promise<void> {
    return crud.setLabelFlags(phone, flags, tenantId);
  }

  public async getOrCreateCustomer(
    phone: string,
    name: string | undefined,
    tenantId: string,
    options?: { skipFollowUpScheduling?: boolean }
  ): Promise<any> {
    return crud.getOrCreateCustomer(phone, name, tenantId, options);
  }

  public async getCustomerById(customerId: string, tenantId: string = DEFAULT_TENANT_ID): Promise<any> {
    return crud.getCustomerById(customerId, tenantId);
  }

  public async getCustomerByPhone(phone: string, tenantId: string): Promise<any> {
    return crud.getCustomerByPhone(phone, tenantId);
  }

  public async updateCustomerName(
    customerId: string,
    name: string,
    tenantId: string,
    options?: { force?: boolean; source?: CustomerNameSource }
  ): Promise<any> {
    return crud.updateCustomerName(customerId, name, tenantId, options);
  }

  public async mergeCustomerPreferences(
    customerId: string,
    tenantId: string,
    patch: Record<string, unknown>
  ): Promise<void> {
    return crud.mergeCustomerPreferences(customerId, tenantId, patch);
  }

  public async updateCustomer(
    customerId: string,
    data: {
      name?: string;
      phone?: string;
      address?: string;
      kelurahan?: string | null;
      kecamatan?: string | null;
      kota?: string | null;
      zipcode?: string | null;
      landmark?: string | null;
      lat?: number | null;
      lng?: number | null;
      forceUpdateGps?: boolean;
      children?: Array<{
        id?: string;
        name: string;
        ageText?: string;
        raw_age_text?: string;
        birthDate?: string | null;
      }>;
    },
    tenantId: string
  ): Promise<any> {
    return crud.updateCustomer(customerId, data, tenantId);
  }

  public async blockCustomer(customerId: string, reason: string, tenantId: string): Promise<any> {
    return crud.blockCustomer(customerId, reason, tenantId);
  }

  public async unblockCustomer(customerId: string, tenantId: string): Promise<any> {
    return crud.unblockCustomer(customerId, tenantId);
  }

  public async setAiOverride(customerId: string, tenantId: string, aiOverride: 'FORCE_ON' | 'FORCE_OFF' | null): Promise<any> {
    return crud.setAiOverride(customerId, tenantId, aiOverride);
  }

  public async getCustomerGroundTruth(
    customerId: string,
    tenantId: string
  ): Promise<CustomerGroundTruth | null> {
    return crud.getCustomerGroundTruth(customerId, tenantId);
  }

  public async syncProfilePictureInBackground(
    customerId: string,
    phone: string,
    tenantId: string,
    force = false
  ): Promise<void> {
    return crud.syncProfilePictureInBackground(customerId, phone, tenantId, force);
  }

  public async updateProfilePicture(
    customerId: string,
    phone: string,
    profilePictureUrl: string | null
  ): Promise<void> {
    return crud.updateProfilePicture(customerId, phone, profilePictureUrl);
  }

  // ── Address Book & Location ──

  public async syncSavedAddressFromLocation(
    customer: any,
    tenantId: string,
    loc: UpsertSavedAddressInput & { isPrimary?: boolean }
  ): Promise<void> {
    return addr.syncSavedAddressFromLocation(customer, tenantId, loc, crud.getCustomerById);
  }

  public async getSavedAddresses(customerId: string, tenantId: string): Promise<SavedCustomerAddress[]> {
    return addr.getSavedAddresses(customerId, tenantId, crud.getCustomerById);
  }

  public async upsertSavedAddress(
    customerId: string,
    input: UpsertSavedAddressInput,
    tenantId: string
  ): Promise<SavedCustomerAddress | null> {
    return addr.upsertSavedAddress(customerId, input, tenantId, crud.getCustomerById);
  }

  public async addSavedAddress(
    customerId: string,
    input: UpsertSavedAddressInput,
    tenantId: string
  ): Promise<SavedCustomerAddress> {
    return addr.addSavedAddress(customerId, input, tenantId, crud.getCustomerById);
  }

  public async setDefaultAddress(customerId: string, addressId: string, tenantId: string): Promise<void> {
    return addr.setDefaultAddress(customerId, addressId, tenantId, crud.getCustomerById);
  }

  public async resolveActiveSavedAddress(customerId: string, tenantId: string): Promise<SavedCustomerAddress | null> {
    return addr.resolveActiveSavedAddress(customerId, tenantId, crud.getCustomerById);
  }

  public async deleteSavedAddress(
    customerId: string,
    addressId: string,
    tenantId: string
  ): Promise<{ deleted: boolean; activeCount: number }> {
    return addr.deleteSavedAddress(customerId, addressId, tenantId, crud.getCustomerById);
  }

  public async updateCustomerLocation(
    customerId: string,
    data: {
      address?: string;
      kelurahan?: string;
      kecamatan?: string;
      kota?: string;
      lat?: number;
      lng?: number;
      distanceKm?: number;
      ongkir?: number;
      isOutOfCoverage?: boolean;
      zipcode?: string;
      isNativePin?: boolean;
      locationSource?: LocationSource;
      isEstimatedCentroid?: boolean;
      labelSource?: 'boundary' | 'centroid' | 'user_stated' | 'manual_staff';
      forceUpdateGps?: boolean;
      savedAddressId?: string;
    },
    tenantId: string
  ): Promise<any> {
    return addr.updateCustomerLocation(
      customerId,
      data,
      tenantId,
      crud.getCustomerById,
      (c, t, l) => this.syncSavedAddressFromLocation(c, t, l)
    );
  }

  public async updateCustomerPendingLocation(
    customerId: string,
    data: {
      kelurahan?: string | null;
      kecamatan?: string | null;
      kota?: string | null;
      lat?: number | null;
      lng?: number | null;
      zipcode?: string | null;
    },
    tenantId: string
  ): Promise<any> {
    return addr.updateCustomerPendingLocation(customerId, data, tenantId);
  }

  public async clearPendingLocation(customerId: string, tenantId: string): Promise<any> {
    return addr.clearPendingLocation(customerId, tenantId);
  }

  public async resetFullLocation(customerId: string, tenantId: string): Promise<any> {
    return addr.resetFullLocation(customerId, tenantId);
  }

  public async promotePendingLocation(
    customerId: string,
    pendingData: {
      pending_kelurahan: string;
      pending_kecamatan: string;
      pending_kota: string;
      pending_lat: number;
      pending_lng: number;
      pending_zipcode?: string | null;
    },
    deliveryCalculator: (coords: { lat: number; lng: number }) => Promise<{
      distanceKm: number;
      ongkir: number;
      isOutOfCoverage: boolean;
    }>,
    tenantId: string
  ): Promise<{ success: boolean; error?: string }> {
    return addr.promotePendingLocation(customerId, pendingData, deliveryCalculator, tenantId);
  }

  public async markShareLocationSent(customerId: string, tenantId: string): Promise<any> {
    return addr.markShareLocationSent(customerId, tenantId);
  }

  public async refreshCustomerLocationAndOngkir(
    customerId: string,
    tenantId: string = DEFAULT_TENANT_ID,
    performedBy?: string
  ): Promise<{
    success: boolean;
    data?: {
      customerId: string;
      source: 'bidan_shareloc' | 'customer_shareloc' | 'db_coords' | 'geocoding' | 'url_coords' | 'url_text_geocoded' | 'manual_staff';
      sourceLabel: string;
      lat: number;
      lng: number;
      distanceKm: number;
      ongkir: number;
      isOutOfCoverage: boolean;
      kelurahan?: string | null;
      kecamatan?: string | null;
      kota?: string | null;
      refreshedAt: string;
      refreshedBy?: string;
    };
    error?: string;
  }> {
    return addr.refreshCustomerLocationAndOngkir(customerId, tenantId, performedBy, crud.getCustomerById);
  }

  public async getLastDeliveryFee(customerId: string, tenantId?: string): Promise<number | null> {
    return addr.getLastDeliveryFee(customerId, tenantId);
  }

  // ── MQL Settings & Tracking ──

  public async getMqlSettings(tenantId: string): Promise<{ mqlThresholdBubbles: number; mqlAutoLeadEnabled: boolean }> {
    return mql.getMqlSettings(tenantId);
  }

  public async updateMqlSettings(
    tenantId: string,
    settings: { mqlThresholdBubbles?: number; mqlAutoLeadEnabled?: boolean }
  ): Promise<{ mqlThresholdBubbles: number; mqlAutoLeadEnabled: boolean }> {
    return mql.updateMqlSettings(tenantId, settings);
  }

  public async incrementCustomerMessageCount(customerId: string, tenantId: string): Promise<{ customer: any; newlyTriggeredMql: boolean }> {
    return mql.incrementCustomerMessageCount(customerId, tenantId);
  }

  // ── LTV & Stats ──

  public async computeCustomerLtv(customerId: string, tenantId?: string): Promise<number> {
    return ltv.computeCustomerLtv(customerId, tenantId);
  }

  public async recalculateCustomerLtv(customerId: string, tenantId?: string): Promise<number> {
    return ltv.recalculateCustomerLtv(customerId, tenantId);
  }

  public async backfillAllLtvCache(): Promise<number> {
    return ltv.backfillAllLtvCache();
  }

  public async getCustomerStats(tenantId: string): Promise<{
    totalCustomers: number;
    totalPurchasers: number;
    totalMql: number;
    totalProspects: number;
    totalRevenue: number;
  }> {
    return ltv.getCustomerStats(tenantId);
  }

  // ── Export & Listing ──

  public async listCustomersWithLtvAndAdClick(
    tenantId: string,
    options?: {
      search?: string;
      page?: number;
      pageSize?: number;
      mqlOnly?: boolean;
      segment?: 'all' | 'purchased' | 'mql' | 'prospect';
      sortBy?: string;
      sortOrder?: 'asc' | 'desc';
    }
  ): Promise<{
    customers: Array<{
      id: string;
      phone: string;
      name: string | null;
      status: string;
      isMql: boolean;
      mqlBubbleCount: number;
      mqlTriggeredAt: Date | null;
      trackingCode: string;
      adClick: any;
      ltv: number;
      reservationCount: number;
      createdAt: Date;
      updatedAt: Date;
      aiOverride: string | null;
      isAdminLabeled: boolean;
      isHoldLabeled: boolean;
      kecamatan: string | null;
      kota: string | null;
      kelurahan: string | null;
      distanceKm: number | null;
      ongkir: number | null;
      staffOwnership?: StaffOwnershipView | null;
    }>;
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
    stats?: {
      totalCustomers: number;
      totalPurchasers: number;
      totalMql: number;
      totalProspects: number;
      totalRevenue: number;
    };
  }> {
    return exp.listCustomersWithLtvAndAdClick(tenantId, options);
  }
}

export const customerService = new CustomerService();
export default customerService;
