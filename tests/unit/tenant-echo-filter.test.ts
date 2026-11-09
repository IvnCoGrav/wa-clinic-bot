import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getTenantEchoPatterns, UNIVERSAL_BOT_ECHO_PREFIXES } from '../../src/services/capi.service';
import { prisma } from '../../src/db/client';

describe('Task S2.1 — Tenant-Aware Echo Bot Filter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('mengembalikan pola echo spesifik untuk Tenant B dari DB tanpa hardcode Kala', async () => {
    vi.spyOn(prisma.tenant, 'findUnique').mockResolvedValueOnce({
      id: 'tenant-beta',
      name: 'Klinik Bunda Sehat',
      greetings_text: 'Halo Bunda, selamat datang di Klinik Bunda Sehat',
      format_visit: 'Format Kunjungan Bunda Sehat',
    } as any);

    vi.spyOn(prisma.clinicPolicy, 'findMany').mockResolvedValueOnce([
      { suggested_reply: 'Untuk kondisi darurat medis anak, segera hubungi IGD terdekat' },
    ] as any);

    const patterns = await getTenantEchoPatterns('tenant-beta');

    expect(patterns).toContain('Klinik Bunda Sehat');
    expect(patterns).toContain('Pricelist Klinik Bunda Sehat');
    expect(patterns).toContain('Halo Bunda, selamat datang di Klinik Bunda Sehat');
    expect(patterns).toContain('Format Kunjungan Bunda Sehat');
    expect(patterns).toContain('Untuk kondisi darurat medis anak, segera');
    // Memastikan tidak ada jejak default Kala Spa bila tidak diminta
    expect(patterns).not.toContain('Kala Spa');
  });

  it('mengenali universal technical markers ([AUTOMATED], [IMAGE:, dll.)', () => {
    const textAutomated = '[AUTOMATED] Pengingat jadwal kontrol';
    const textImage = '[IMAGE: Pricelist Klinik Bunda Sehat]';

    const isAutomated = UNIVERSAL_BOT_ECHO_PREFIXES.some((p) => textAutomated.startsWith(p));
    const isImage = UNIVERSAL_BOT_ECHO_PREFIXES.some((p) => textImage.startsWith(p));
    const isManualText = 'Halo bu, saya bidan piket hari ini';

    expect(isAutomated).toBe(true);
    expect(isImage).toBe(true);
    expect(UNIVERSAL_BOT_ECHO_PREFIXES.some((p) => isManualText.startsWith(p))).toBe(false);
  });

  it('memastikan balasan bot Tenant B terdeteksi sebagai echo dan tidak dianggap chat admin manual', async () => {
    vi.spyOn(prisma.tenant, 'findUnique').mockResolvedValueOnce({
      id: 'tenant-beta',
      name: 'Klinik Bunda Sehat',
      greetings_text: 'Halo Bunda di Klinik Bunda Sehat',
      format_visit: null,
    } as any);
    vi.spyOn(prisma.clinicPolicy, 'findMany').mockResolvedValueOnce([
      { suggested_reply: 'Bunda, untuk kondisi darurat segera hubungi IGD' },
    ] as any);

    const echoPatterns = await getTenantEchoPatterns('tenant-beta');
    const botReplyText = 'Bunda, untuk kondisi darurat segera hubungi IGD terdekat ya.';

    const isDeviceAutoGreeting = echoPatterns.some((p) => p && botReplyText.includes(p));
    const isTechnicalMarker = UNIVERSAL_BOT_ECHO_PREFIXES.some((p) => botReplyText.startsWith(p));
    const isBotAutoReply = isTechnicalMarker || isDeviceAutoGreeting;

    expect(isBotAutoReply).toBe(true);
  });
});
