-- Composite indexes untuk query admin dashboard yang sering dipanggil (ORDER BY created_at / last_message_at).
-- Ukuran data saat ini kecil (<100 record) sehingga pembuatan index instan & tanpa downtime berarti.
-- Untuk tabel sangat besar di masa depan: jalankan CREATE INDEX CONCURRENTLY secara manual via psql,
-- karena CONCURRENTLY tidak bisa dijalankan di dalam transaksi Prisma migration.

-- Customer: listCustomersWithLtvAndAdClick (filter tenant + order created_at desc)
CREATE INDEX "customers_tenant_id_created_at_idx" ON "customers"("tenant_id", "created_at");

-- Conversation: live chat list (filter tenant + order is_human_handling desc, last_message_at desc)
CREATE INDEX "conversations_tenant_human_lastmsg_idx" ON "conversations"("tenant_id", "is_human_handling", "last_message_at");

-- Message: getRecentMessages per conversation (filter conversation_id + tenant, order created_at desc)
CREATE INDEX "messages_conversation_tenant_created_idx" ON "messages"("conversation_id", "tenant_id", "created_at");

-- Reservation: reservations list (filter tenant + order created_at desc)
CREATE INDEX "reservations_tenant_id_created_at_idx" ON "reservations"("tenant_id", "created_at");
