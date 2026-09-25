-- SEC-AUDIT-02: sesi Super Admin hanya dalam bentuk hash (pola StaffSession),
-- menggantikan storage/admin_sessions.json plaintext. Idempoten (IF NOT EXISTS).

-- CreateTable
CREATE TABLE IF NOT EXISTS "admin_sessions" (
    "id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "admin_identity" TEXT NOT NULL DEFAULT 'System Admin',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "admin_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "admin_sessions_token_hash_key" ON "admin_sessions"("token_hash");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "admin_sessions_token_hash_idx" ON "admin_sessions"("token_hash");
