-- KNOWN #358 (Fase 2 / A-008, 2026-11-18):
-- Backfill kolom `messages.is_revoked`, `revoked_at`, dan `revoked_by` untuk
-- 156 pesan revoke historis yang sebelumnya hanya menulis `payload_raw->>'is_revoked' = 'true'`.
-- Raw SQL sidebar Live Chat (live-chat.service.ts:127-138) membaca kolom `is_revoked` langsung.
-- Idempoten & tenant-agnostic.

UPDATE "messages"
SET "is_revoked" = true,
    "revoked_at" = COALESCE(
      "revoked_at",
      CASE
        WHEN ("payload_raw"->>'revoked_at') ~ '^\d{4}-\d{2}-\d{2}T'
        THEN ("payload_raw"->>'revoked_at')::timestamptz
        ELSE "created_at"
      END
    ),
    "revoked_by" = COALESCE("revoked_by", 'UNKNOWN_HISTORICAL')
WHERE LOWER(COALESCE("payload_raw"->>'is_revoked', '')) = 'true'
  AND "is_revoked" = false;
