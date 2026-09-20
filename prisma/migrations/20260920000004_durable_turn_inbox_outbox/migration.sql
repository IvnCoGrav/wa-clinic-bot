-- CreateEnum
CREATE TYPE "InboundTurnStatus" AS ENUM ('RECEIVED', 'QUEUED', 'PROCESSING', 'RESPONSE_READY', 'DELIVERED', 'FAILED', 'HANDOFF');

-- CreateEnum
CREATE TYPE "OutboundAttemptStatus" AS ENUM ('SENDING', 'SENT', 'FAILED', 'UNKNOWN');

-- CreateTable
CREATE TABLE "inbound_turns" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT 'default-tenant',
    "provider" TEXT NOT NULL DEFAULT 'WAHA',
    "inbound_message_id" TEXT NOT NULL,
    "customer_id" TEXT,
    "conversation_id" TEXT,
    "status" "InboundTurnStatus" NOT NULL DEFAULT 'RECEIVED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inbound_turns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbound_attempts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT 'default-tenant',
    "turn_id" TEXT NOT NULL,
    "bubble_index" INTEGER NOT NULL,
    "content_hash" TEXT,
    "status" "OutboundAttemptStatus" NOT NULL DEFAULT 'SENDING',
    "provider_message_id" TEXT,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outbound_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inbound_turns_tenant_id_status_idx" ON "inbound_turns"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "inbound_turns_status_created_at_idx" ON "inbound_turns"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "inbound_turns_tenant_id_provider_inbound_message_id_key" ON "inbound_turns"("tenant_id", "provider", "inbound_message_id");

-- CreateIndex
CREATE INDEX "outbound_attempts_tenant_id_status_idx" ON "outbound_attempts"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "outbound_attempts_turn_id_bubble_index_key" ON "outbound_attempts"("turn_id", "bubble_index");

