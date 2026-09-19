-- Pembedaan New vs Repeat Order (Meta CAPI standard Purchase + custom_data).
-- Kolom `is_repeat_order` sudah ada di schema.prisma & DB live (ditambahkan via
-- `prisma db push` pada masa awal), namun TIDAK pernah tercatat di chain migrasi
-- sehingga fresh deploy tidak memilikinya -> drift. Migrasi ini menutup gap:
-- idempotent (aman di DB live yang kolomnya sudah ada maupun fresh DB).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'reservations' AND column_name = 'is_repeat_order'
  ) THEN
    ALTER TABLE "reservations" ADD COLUMN "is_repeat_order" BOOLEAN NOT NULL DEFAULT false;
  END IF;
END $$;
