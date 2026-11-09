/**
 * In-Memory store fallback untuk record pesan (agar Live Chat panel tetap jalan saat DB offline).
 * Batas FIFO (ring buffer) agar RAM tidak membengkak seiring bertambahnya percakapan.
 * Dikeluarkan ke modul tersendiri untuk mencegah circular dependency antar sub-service (SM-01).
 */
export const memoryMessages: any[] = [];
export const MAX_MEMORY_MESSAGES = 500;
