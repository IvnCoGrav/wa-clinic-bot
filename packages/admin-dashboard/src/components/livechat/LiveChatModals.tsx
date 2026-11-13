// Catatan kontrak error: catch kosong di kumpulan modal ini adalah pengayaan
// data (detail pelanggan, jumlah alamat tersimpan). Data ringkas dari daftar
// chat sudah tampil, jadi kegagalan pengayaan tidak boleh mengosongkan modal.
import React from 'react';
import { PenLine, Info, Check, X } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { LiveChatCustomerModal } from './LiveChatCustomerModal';
import { CustomerEditForm } from '../modals/CustomerEditForm';
import { AddressBookDrawer } from '../customer/AddressBookDrawer';
import { ReservationDetailModal } from '../modals/ReservationDetailModal';
import { LiveChatPaymentProofModal } from './LiveChatPaymentProofModal';
import { CreateReservationModal } from '../calendar/CreateReservationModal';
import { QuickHoldModal } from '../calendar/QuickHoldModal';
import { DailyScheduleModal } from '../calendar/DailyScheduleModal';
import { InvoiceGeneratorModal } from '../modals/InvoiceGeneratorModal';
import { LiveChatMessageContextMenu } from './LiveChatMessageContextMenu';
import { LiveChatSyncModal } from './LiveChatSyncModal';
import { ChatExport } from '../../pages/tenant/ChatExport';
import { apiRequest } from '../../services/api';
import { useUiFeedback } from '../common/UiFeedback';
import { generateReservationInvoiceText } from '../../utils/paymentInvoiceFormatter';
import type { LiveChatItem, CustomerLabelData } from '../../types/livechat';
import type { ExtractedScheduleData } from '../../utils/chatScheduleExtractor';

export interface LiveChatModalsProps {
  // Customer Detail Modal & Edit Form
  customerDetailModalOpen: boolean;
  setCustomerDetailModalOpen: (open: boolean) => void;
  customerDetailData: any;
  setCustomerDetailData: React.Dispatch<React.SetStateAction<any>>;
  selectedChat: LiveChatItem | null | undefined;
  customerDetailLoading: boolean;
  savedAddressCount: number;
  setSavedAddressCount: (count: number) => void;
  customerDetailEditMode: boolean;
  setCustomerDetailEditMode: (edit: boolean) => void;
  handleSaveCustomerDetail: (data: any) => Promise<void>;
  // Address Book
  addrBookCustomer: { id: string; name?: string } | null;
  setAddrBookCustomer: (c: { id: string; name?: string } | null) => void;
  // Reservation Detail
  selectedReservation: any;
  setSelectedReservation: (res: any) => void;
  reservationStaffList: any[];
  user: any;
  handleReservationUpdate: (deletedReservationId?: string) => Promise<void>;
  // Payment Proof
  proofModalReservation: any;
  setProofModalReservation: (res: any) => void;
  // Quick Booking & Hold
  showQuickBookingModal: boolean;
  setShowQuickBookingModal: (show: boolean) => void;
  activeEditingConfirmedReservation: any;
  setActiveEditingConfirmedReservation: (res: any) => void;
  activeEditingHoldReservation: any;
  setActiveEditingHoldReservation: (res: any) => void;
  convertingHoldId: string | null;
  setConvertingHoldId: (id: string | null) => void;
  quickBookingTargetSlot: any;
  setQuickBookingTargetSlot: (slot: any) => void;
  quickBookingExtracted: ExtractedScheduleData | null;
  setQuickBookingExtracted: (ex: ExtractedScheduleData | null) => void;
  handleInsertInvoiceToChat: (text: string) => void;
  showQuickHoldModal: boolean;
  setShowQuickHoldModal: (show: boolean) => void;
  quickHoldInitialDate: Date | string | null;
  setQuickHoldInitialDate: (d: Date | string | null) => void;
  quickHoldInitialTime: string | null;
  setQuickHoldInitialTime: (t: string | null) => void;
  setChats: React.Dispatch<React.SetStateAction<LiveChatItem[]>>;
  chatsRef: React.MutableRefObject<LiveChatItem[]>;
  loadChats: (reset?: boolean) => Promise<void>;
  // Daily Schedule & Invoice
  showDailyScheduleModal: boolean;
  setShowDailyScheduleModal: (show: boolean) => void;
  handleSlotHold: (date: string, time: string) => Promise<void>;
  showInvoiceModal: boolean;
  setShowInvoiceModal: (show: boolean) => void;
  invoiceModalData: any;
  clinicServices: any[];
  // Context Menu
  contextMenu: { x: number; y: number; chat: LiveChatItem } | null;
  setContextMenu: (ctx: { x: number; y: number; chat: LiveChatItem } | null) => void;
  allLabels: CustomerLabelData[];
  togglingLabelId: string | null;
  handleTogglePin: (chat: LiveChatItem) => Promise<void>;
  handleToggleReadStatus: (chat: LiveChatItem) => Promise<void>;
  handleTakeover: (chat: LiveChatItem) => Promise<void>;
  handleRelease: (chat: LiveChatItem) => Promise<void>;
  handleDismissFrustration: (chat: LiveChatItem) => Promise<void>;
  handleToggleLabel: (customerId: string, label: CustomerLabelData) => Promise<void>;
  // Edit Message
  editingMsg: { id: string; content: string } | null;
  setEditingMsg: (msg: { id: string; content: string } | null) => void;
  isEditingSaving: boolean;
  editContent: string;
  setEditContent: (c: string) => void;
  handleSaveEdit: () => Promise<void>;
  // Export Chat
  searchParams: URLSearchParams;
  setSearchParams: (params: URLSearchParams, options?: { replace?: boolean }) => void;
  // WhatsApp Sync
  showSyncInfoModal: boolean;
  setShowSyncInfoModal: (show: boolean) => void;
  handleStartBackgroundFullSync: () => Promise<void>;
}

export const LiveChatModals: React.FC<LiveChatModalsProps> = ({
  customerDetailModalOpen,
  setCustomerDetailModalOpen,
  customerDetailData,
  setCustomerDetailData,
  selectedChat,
  customerDetailLoading,
  savedAddressCount,
  setSavedAddressCount,
  customerDetailEditMode,
  setCustomerDetailEditMode,
  handleSaveCustomerDetail,
  addrBookCustomer,
  setAddrBookCustomer,
  selectedReservation,
  setSelectedReservation,
  reservationStaffList,
  user,
  handleReservationUpdate,
  proofModalReservation,
  setProofModalReservation,
  showQuickBookingModal,
  setShowQuickBookingModal,
  activeEditingConfirmedReservation,
  setActiveEditingConfirmedReservation,
  activeEditingHoldReservation,
  setActiveEditingHoldReservation,
  convertingHoldId,
  setConvertingHoldId,
  quickBookingTargetSlot,
  setQuickBookingTargetSlot,
  quickBookingExtracted,
  setQuickBookingExtracted,
  handleInsertInvoiceToChat,
  showQuickHoldModal,
  setShowQuickHoldModal,
  quickHoldInitialDate,
  setQuickHoldInitialDate,
  quickHoldInitialTime,
  setQuickHoldInitialTime,
  setChats,
  chatsRef,
  loadChats,
  showDailyScheduleModal,
  setShowDailyScheduleModal,
  handleSlotHold,
  showInvoiceModal,
  setShowInvoiceModal,
  invoiceModalData,
  clinicServices,
  contextMenu,
  setContextMenu,
  allLabels,
  togglingLabelId,
  handleTogglePin,
  handleToggleReadStatus,
  handleTakeover,
  handleRelease,
  handleDismissFrustration,
  handleToggleLabel,
  editingMsg,
  setEditingMsg,
  isEditingSaving,
  editContent,
  setEditContent,
  handleSaveEdit,
  searchParams,
  setSearchParams,
  showSyncInfoModal,
  setShowSyncInfoModal,
  handleStartBackgroundFullSync,
}) => {

  const { toast } = useUiFeedback();

  return (
    <>
      {/* Customer Detail Modal */}
      <LiveChatCustomerModal
        isOpen={customerDetailModalOpen}
        customerDetailData={customerDetailData}
        selectedChat={selectedChat}
        customerDetailLoading={customerDetailLoading}
        savedAddressCount={savedAddressCount}
        onClose={() => setCustomerDetailModalOpen(false)}
        onOpenAddressBook={(cid, name) => setAddrBookCustomer({ id: cid, name })}
        onEditProfile={() => setCustomerDetailEditMode(true)}
        onSelectReservation={(r) => setSelectedReservation(r)}
        onViewProofModal={(r) => setProofModalReservation(r)}
        onRefreshFollowUp={async () => {
          const cid = customerDetailData?.id || selectedChat?.customerId;
          if (!cid) return;
          try {
            const res: any = await apiRequest(`/api/admin/customers/${cid}`);
            if (res?.success && res.data) setCustomerDetailData((prev: any) => ({ ...prev, ...res.data, follow_ups: res.data.follow_ups || prev?.follow_ups }));
          } catch {}
        }}
      />

      {/* Edit Profil Modal - terpisah, placement seperti ReservationDetailModal (tidak nested, full overlay) */}
      {customerDetailEditMode && (
        <CustomerEditForm
          key={customerDetailData?.id || selectedChat?.customerId}
          resetKey={customerDetailData?.updated_at || customerDetailData?.updatedAt}
          customer={{
            id: customerDetailData?.id || selectedChat?.customerId || '',
            name: customerDetailData?.name || selectedChat?.customerName || null,
            phone: customerDetailData?.phone || selectedChat?.customerPhone || '',
            address: customerDetailData?.preferences?.address || customerDetailData?.preferences?.full_address || '',
            kelurahan: customerDetailData?.kelurahan || null,
            kecamatan: customerDetailData?.kecamatan || null,
            kota: customerDetailData?.kota || null,
            zipcode: customerDetailData?.zipcode || null,
            landmark: customerDetailData?.preferences?.landmark || customerDetailData?.preferences?.address_notes || null,
            lat: customerDetailData?.lat ?? null,
            lng: customerDetailData?.lng ?? null,
            children: customerDetailData?.children || [],
            preferences: customerDetailData?.preferences,
          }}
          onSave={handleSaveCustomerDetail}
          onCancel={() => setCustomerDetailEditMode(false)}
          loading={customerDetailLoading}
        />
      )}

      {/* Buku Alamat Drawer - multi-rumah pelanggan di WhatsApp Live Chat (Fase 3) */}
      <AddressBookDrawer
        customer={addrBookCustomer}
        onClose={() => setAddrBookCustomer(null)}
        onChanged={async () => {
          const cid = customerDetailData?.id || selectedChat?.customerId;
          if (cid) {
            try {
              const res: any = await apiRequest(`/api/admin/customers/${cid}`);
              if (res?.success && res.data) {
                setCustomerDetailData((prev: any) => ({ ...prev, ...res.data, follow_ups: res.data.follow_ups || prev?.follow_ups }));
              }
              const addrRes: any = await apiRequest(`/api/admin/customers/${cid}/addresses`);
              if (addrRes?.success && Array.isArray(addrRes.addresses)) {
                setSavedAddressCount(addrRes.addresses.length);
              }
            } catch {}
          }
        }}
      />

      {/* Reservation Detail Modal dari riwayat (klik card) */}
      {selectedReservation && (
        <ReservationDetailModal
          reservation={selectedReservation}
          staffList={reservationStaffList}
          user={user}
          googleCalendarMockActive={false}
          onClose={() => setSelectedReservation(null)}
          onUpdate={handleReservationUpdate}
          onConfirm={async (id: string) => { await apiRequest(`/api/admin/reservation/${id}/confirm`, { method: 'PATCH' }); await handleReservationUpdate(); }}
          onComplete={async (id: string) => { await apiRequest(`/api/admin/reservation/${id}/complete`, { method: 'PATCH' }); await handleReservationUpdate(); }}
          onStatusChange={async (id: string, s: string) => { await apiRequest(`/api/admin/reservation/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status: s }) }); await handleReservationUpdate(); }}
          onSetDate={async (id: string, d: string) => { await apiRequest(`/api/admin/reservation/${id}/set-date`, { method: 'PATCH', body: JSON.stringify({ bookingDate: new Date(d).toISOString() }) }); await handleReservationUpdate(); }}
          onAssignStaff={async (id, sid) => { await apiRequest(`/api/admin/reservation/${id}/assign-staff`, { method: 'PATCH', body: JSON.stringify({ assigned_staff_id: sid }) }); await handleReservationUpdate(); }}
          onDelete={async (id: string) => { await apiRequest(`/api/admin/reservation/${id}?soft=true`, { method: 'DELETE' }); setSelectedReservation(null); await handleReservationUpdate(id); }}
          onCancel={async (id: string) => { await apiRequest(`/api/admin/reservation/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'cancelled' }) }); setSelectedReservation(null); await handleReservationUpdate(); }}
          onDeletePermanent={async (id) => { await apiRequest(`/api/admin/reservation/${id}`, { method: 'DELETE' }); setSelectedReservation(null); await handleReservationUpdate(id); }}
          onProofUpload={async (file) => {
            const toB64 = (f: File) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(new Error('read fail')); r.readAsDataURL(f); });
            const b64 = await toB64(file);
            await apiRequest(`/api/admin/reservation/${selectedReservation.id}/proof`, { method: 'PUT', body: JSON.stringify({ imageB64: b64, mimeType: file.type, fileName: file.name }) });
            await handleReservationUpdate();
          }}
          onProofRemove={async () => { await apiRequest(`/api/admin/reservation/${selectedReservation.id}/proof`, { method: 'PUT', body: JSON.stringify({ remove: true }) }); await handleReservationUpdate(); }}
          onOpenEditLocation={() => toast('Edit lokasi via menu Reservations untuk akses penuh.', 'info')}
          onProofView={(r) => window.open(r.proof_url!, '_blank')}
          onHousePhotoView={(url) => window.open(url, '_blank')}
          // Monitor SUDAH menampilkan thread percakapan: tombol Riwayat Chat
          // menutup detail agar admin langsung kembali ke thread customer tsb.
          onOpenChatHistory={() => setSelectedReservation(null)}
        />
      )}

      {/* Payment Proof Viewer Modal dari Live Chat Monitor */}
      <LiveChatPaymentProofModal
        reservation={proofModalReservation}
        customerName={selectedChat?.customerName}
        customerPhone={selectedChat?.customerPhone}
        onClose={() => setProofModalReservation(null)}
      />

      {/* Quick Create Reservation Modal dari Live Chat */}
      {showQuickBookingModal && (
        <CreateReservationModal
          isOpen={showQuickBookingModal}
          mode={activeEditingHoldReservation || activeEditingConfirmedReservation ? 'edit' : 'create'}
          initialReservation={activeEditingHoldReservation || activeEditingConfirmedReservation || undefined}
          onEditReservation={(res) => setSelectedReservation(res)}
          onClose={() => {
            setShowQuickBookingModal(false);
            setConvertingHoldId(null);
            setActiveEditingHoldReservation(null);
            setActiveEditingConfirmedReservation(null);
            setQuickBookingTargetSlot(null);
            setQuickBookingExtracted(null);
          }}
          staffList={reservationStaffList}
          initialSlotTarget={quickBookingTargetSlot}
          initialCustomer={
            (customerDetailData && customerDetailData.id === selectedChat?.customerId)
              ? customerDetailData
              : (selectedChat?.customerId ? {
                  id: selectedChat.customerId,
                  name: selectedChat.customerName,
                  phone: selectedChat.customerPhone,
                  kelurahan: (selectedChat as any).kelurahan || null,
                  kecamatan: (selectedChat as any).kecamatan || null,
                  kota: (selectedChat as any).kota || null,
                  address: (selectedChat as any).address || (selectedChat as any).preferences?.address || null,
                  preferences: (selectedChat as any).preferences || {},
                  children: (selectedChat as any).children || [],
                  ongkir: (selectedChat as any).ongkir ?? 0,
                  distance_km: (selectedChat as any).distanceKm ?? (selectedChat as any).distance_km ?? null,
                } : null)
          }
          initialCustomerId={selectedChat?.customerId}
          initialTreatmentName={quickBookingExtracted?.treatmentName}
          initialTreatmentCategory={quickBookingExtracted?.treatmentCategory as any}
          initialBabies={quickBookingExtracted?.babies?.length ? quickBookingExtracted.babies : (quickBookingExtracted?.childName ? [{ name: quickBookingExtracted.childName, ageText: quickBookingExtracted.childAge || '' }] : undefined)}
          initialNotes={quickBookingExtracted?.treatmentName && quickBookingExtracted.treatmentName.trim() ? `Request dari chat: ${quickBookingExtracted.treatmentName}` : undefined}
          initialAddress={quickBookingExtracted?.address || (selectedChat as any)?.address || (selectedChat as any)?.preferences?.address || null}
          initialLandmark={(selectedChat as any)?.preferences?.landmark || (selectedChat as any)?.preferences?.address_notes || null}
          onSuccess={async (newRes: any) => {
            setShowQuickBookingModal(false);
            setConvertingHoldId(null);
            setActiveEditingHoldReservation(null);
            setActiveEditingConfirmedReservation(null);
            setQuickBookingTargetSlot(null);
            setQuickBookingExtracted(null);
            await handleReservationUpdate();
            // Invoice HANYA dimasukkan lewat onSuccessAndInvoice (pilihan eksplisit
            // "Simpan & Masukkan Invoice"). "Simpan Jadwal Saja" tidak membuka modal
            // invoice liar apa pun (kontrak `_withInvoice`).
          }}
          onSuccessAndInvoice={(newRes) => {
            const rawCust = (customerDetailData && customerDetailData.id === selectedChat?.customerId)
              ? customerDetailData
              : (selectedChat ? {
                  name: selectedChat.customerName,
                  phone: selectedChat.customerPhone,
                  address: (selectedChat as any).address || (selectedChat as any).preferences?.address || '',
                  kelurahan: (selectedChat as any).kelurahan || null,
                  kecamatan: (selectedChat as any).kecamatan || null,
                  kota: (selectedChat as any).kota || null,
                  ongkir: (selectedChat as any).ongkir ?? 0,
                  distance_km: (selectedChat as any).distanceKm ?? (selectedChat as any).distance_km ?? null,
                  preferences: (selectedChat as any).preferences || {},
                } : null);
            // Merge babies: prioritas newRes.babies (form enrichment) > rawCust.children
            const mergedChildren = (newRes?.babies && Array.isArray(newRes.babies) && newRes.babies.length > 0)
              ? newRes.babies.map((b: any) => ({ name: b.name, raw_age_text: b.age, current_age: b.age }))
              : (rawCust?.children || []);
            const customerObj = rawCust ? { ...rawCust, children: mergedChildren } : null;
            const invoiceText = generateReservationInvoiceText({
              reservation: newRes,
              customer: customerObj as any,
              discount: Number(newRes?.discount || 0),
            });
            handleInsertInvoiceToChat(invoiceText);
            toast('Reservasi berhasil disimpan & format invoice langsung dimasukkan ke chat WhatsApp!', 'success');
          }}
        />
      )}

      {/* Quick Hold Modal dari Live Chat (Kunci Slot Kilat 3 Detik) */}
      {showQuickHoldModal && (
        <QuickHoldModal
          isOpen={showQuickHoldModal}
          onClose={() => { setShowQuickHoldModal(false); setQuickHoldInitialDate(null); setQuickHoldInitialTime(null); }}
          staffList={reservationStaffList}
          initialDate={quickHoldInitialDate}
          initialTime={quickHoldInitialTime}
          initialCustomer={
            (customerDetailData && customerDetailData.id === selectedChat?.customerId)
              ? customerDetailData
              : (selectedChat?.customerId ? {
                  id: selectedChat.customerId,
                  name: selectedChat.customerName,
                  phone: selectedChat.customerPhone,
                  kelurahan: (selectedChat as any).kelurahan,
                  kecamatan: (selectedChat as any).kecamatan,
                  kota: (selectedChat as any).kota,
                  distance_km: (selectedChat as any).distanceKm ?? (selectedChat as any).distance_km,
                } : null)
          }
          onSuccess={async (newHold: any) => {
            setShowQuickHoldModal(false);
            await handleReservationUpdate();
            // Instant 0ms: patch chats list so activeHoldReservation langsung muncul tanpa tunggu fetch
            if (newHold && selectedChat) {
              const holdObj = {
                id: newHold.id,
                booking_date: newHold.booking_date,
                treatment_category: newHold.treatment_category,
                treatment_detail: newHold.treatment_detail,
                assigned_staff_id: newHold.assigned_staff_id,
                assigned_staff: newHold.assigned_staff || null,
                notes: newHold.notes || null,
                customer_id: newHold.customer_id || selectedChat.customerId,
                status: 'hold',
              };
              setChats((prev) => {
                const updated = prev.map((c) => c.conversationId === selectedChat.conversationId ? { ...c, hasActiveHold: true, activeHoldReservation: holdObj } : c);
                chatsRef.current = updated;
                return updated;
              });
              // sync detail juga agar fallback konsisten
              setCustomerDetailData((prev: any) => prev ? { ...prev, reservations: [...(prev.reservations || []), holdObj] } : prev);
            } else {
              loadChats(true);
            }
          }}
          onInsertToChat={handleInsertInvoiceToChat}
        />
      )}

      {/* Daily Schedule Modal (Tools + → Cek Jadwal Harian) */}
      {showDailyScheduleModal && (
        <DailyScheduleModal
          isOpen={showDailyScheduleModal}
          onClose={() => setShowDailyScheduleModal(false)}
          onSelectSlot={handleSlotHold}
          onSelectReservation={(res: any) => {
            setShowDailyScheduleModal(false);
            setSelectedReservation(res);
          }}
          onInsertToChat={handleInsertInvoiceToChat}
        />
      )}

      {/* Draft Preview & Invoice Generator Modal */}
      {showInvoiceModal && invoiceModalData && (
        <InvoiceGeneratorModal
          isOpen={showInvoiceModal}
          onClose={() => setShowInvoiceModal(false)}
          initialData={invoiceModalData}
          customerId={(invoiceModalData as any)?.customerId || selectedChat?.customerId}
          clinicServices={clinicServices}
          onInsertToChat={handleInsertInvoiceToChat}
        />
      )}

      {/* Context Menu: bottom-sheet + backdrop di MOBILE; floating popover di DESKTOP
          (posisi mengikuti koordinat klik kanan, tanpa backdrop pembajak layar). */}
      <LiveChatMessageContextMenu
        contextMenu={contextMenu}
        allLabels={allLabels}
        togglingLabelId={togglingLabelId}
        onClose={() => setContextMenu(null)}
        onTogglePin={handleTogglePin}
        onToggleReadStatus={handleToggleReadStatus}
        onTakeover={handleTakeover}
        onRelease={handleRelease}
        onDismissFrustration={handleDismissFrustration}
        onToggleLabel={handleToggleLabel}
      />

      {/* Edit Message Modal */}
      {editingMsg && (
        <Modal
          open
          onClose={() => setEditingMsg(null)}
          size="md"
          title={
            <span className="flex items-center gap-2">
              <PenLine size={16} className="text-accent" aria-hidden="true" />
              <span>Edit Pesan WhatsApp</span>
            </span>
          }
          footer={
            <>
              <button
                type="button"
                onClick={() => setEditingMsg(null)}
                disabled={isEditingSaving}
                className="px-4 py-2 bg-surface hover:bg-fill-1 border border-divider text-ink rounded-xl text-xs font-semibold transition cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleSaveEdit}
                disabled={isEditingSaving || !editContent.trim()}
                className="px-4 py-2 bg-accent hover:bg-accent-hover disabled:opacity-50 text-on-solid rounded-xl text-xs font-bold transition flex items-center space-x-1.5 shadow-xs cursor-pointer"
              >
                {isEditingSaving ? (
                  <>
                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />
                    <span>Menyimpan...</span>
                  </>
                ) : (
                  <>
                    <Check size={14} aria-hidden="true" />
                    <span>Simpan Perubahan</span>
                  </>
                )}
              </button>
            </>
          }
        >
          <div className="p-3 bg-warning-soft border border-warning-line rounded-xl text-[11px] text-warning space-y-1">
            <p className="font-bold flex items-center gap-1.5">
              <Info size={13} className="text-warning shrink-0" aria-hidden="true" />
              Batas Waktu Edit WhatsApp: 15 Menit
            </p>
            <p className="text-warning leading-relaxed">
              WhatsApp hanya mengizinkan pengeditan pesan dalam 15 menit pertama. Pesan yang diedit akan otomatis memiliki label <i>(Diedit)</i> di HP penerima.
            </p>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="edit-message-content" className="block text-[11px] font-bold text-ink">
              Isi Pesan Baru
            </label>
            <textarea
              id="edit-message-content"
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              rows={4}
              placeholder="Ketik perbaikan teks pesan..."
              className="w-full bg-surface border border-divider rounded-xl p-3 text-xs text-ink placeholder-ink-3 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition shadow-xs leading-relaxed"
            />
          </div>
        </Modal>
      )}

      {/* Chat Export Modal (konsolidasi dari page ChatExport — via ?action=export) */}
      {(searchParams.get('action') === 'export' || searchParams.get('export') === '1') && (
        <Modal
          open
          onClose={() => {
            const p = new URLSearchParams(searchParams.toString());
            p.delete('action');
            p.delete('export');
            setSearchParams(p, { replace: true });
          }}
          size="xl"
          title="Ekspor Chat"
        >
          <ChatExport />
        </Modal>
      )}

      {/* 📋 Modal Informasi & Konfirmasi Sinkronisasi WhatsApp */}
      <LiveChatSyncModal
        isOpen={showSyncInfoModal}
        onClose={() => setShowSyncInfoModal(false)}
        onConfirm={handleStartBackgroundFullSync}
      />
      
    </>
  );
};
