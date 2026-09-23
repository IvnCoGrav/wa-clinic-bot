-- V1 AI Router decommission: tabel `ai_router_evaluations` tidak lagi menerima
-- write sejak V2/V3 agent aktif. Model sudah dihapus dari schema.prisma.
DROP TABLE IF EXISTS "ai_router_evaluations" CASCADE;
