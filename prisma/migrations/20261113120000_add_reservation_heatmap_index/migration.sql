-- Analitik heatmap treatment: query agregasi per tenant/status/rentang tanggal
-- (completed-only dalam jendela bulan) tanpa full scan tabel reservasi.
CREATE INDEX "reservations_tenant_id_status_booking_date_idx" ON "reservations"("tenant_id", "status", "booking_date");
