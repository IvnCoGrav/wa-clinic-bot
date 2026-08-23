import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConversationState } from '@prisma/client';
import {
  normalizePhone,
  extractSubdistrictFromAddress,
  parseAllHistoricalCustomerLocations,
} from '../../scripts/scrape-and-backfill-customer-locations';
import { handleGreetingState } from '../../src/state-machine/handlers/greeting';
import { handleInterestState } from '../../src/state-machine/handlers/interest';
import { TEMPLATES } from '../../src/config/persona';

describe('Customer Location Backfill & Flow Integration Tests', () => {
  describe('Extractor Unit Logic', () => {
    it('normalizes Indonesian phone numbers accurately', () => {
      expect(normalizePhone('081233285194')).toBe('6281233285194');
      expect(normalizePhone('+62 812-3328-5194')).toBe('6281233285194');
      expect(normalizePhone('6281233285194')).toBe('6281233285194');
      expect(normalizePhone('81233285194')).toBe('6281233285194');
    });

    it('extracts subdistrict, district, and city from address string', () => {
      const res1 = extractSubdistrictFromAddress('jl kertajaya 4/16, gubeng, surabaya');
      expect(res1.kota).toBe('Surabaya');
      expect(res1.kelurahan).toBe('gubeng');

      const res2 = extractSubdistrictFromAddress('Kalibader RT 21 RW 3 kel. Kalijaten kec. Taman kab. Sidoarjo');
      expect(res2.kota).toBe('Sidoarjo');
      expect(res2.kelurahan).toBe('Kalijaten');
      expect(res2.kecamatan).toBe('Taman');
    });

    it('parses all historical customer locations from transcripts without error', async () => {
      const map = await parseAllHistoricalCustomerLocations();
      expect(map.size).toBeGreaterThan(0);
      
      // Check sample known customer from clean transaction md
      const sample = map.get('6281233285194');
      expect(sample).toBeDefined();
      expect(sample?.name).toBe('jeanetta');
      expect(sample?.ongkir).toBe(25000);
    });
  });

  describe('Bot State Machine Flow with Backfilled Location', () => {
    it('customer with known location skips AWAITING_LOCATION when chatting in INITIAL state', async () => {
      const mockCustomer = {
        id: 'cust_backfilled_1',
        phone: '6281233285194',
        name: 'Bunda Jeanetta',
        kelurahan: 'Gubeng',
        kecamatan: 'Gubeng',
        kota: 'Surabaya',
        lat: -7.275,
        lng: 112.755,
        ongkir: 25000,
        tenant_id: 'default-tenant',
        status: 'active',
      } as any;

      const mockConversation = {
        id: 'conv_123',
        tenant_id: 'default-tenant',
        customer_id: mockCustomer.id,
        current_state: ConversationState.INITIAL,
        last_message_at: new Date(Date.now() - 1000 * 60 * 60 * 50),
        created_at: new Date(Date.now() - 1000 * 60 * 60 * 50),
      } as any;

      const ctx = {
        customer: mockCustomer,
        conversation: mockConversation,
        incomingMessage: {
          id: 'msg_1',
          chatId: '6281233285194@c.us',
          from: '6281233285194',
          fromMe: false,
          type: 'chat',
          text: { body: 'Iya betul Bunda' },
          timestamp: Date.now(),
        } as any,
        tenantId: 'default-tenant',
        nluResult: {
          intents: ['affirmation'],
          confidence: 0.9,
          isFallback: false,
        } as any,
      };

      const result = await handleGreetingState(ctx);
      expect(result.nextState).toBe(ConversationState.AWAITING_INTEREST);
      expect(result.replyText).toContain('Kelurahan Gubeng');
    });

    it('prefills customer name and address in reservation form when location is known', async () => {
      const formText = TEMPLATES.reservationFormRequest({
        name: 'Jeanetta',
        address: 'Gubeng',
        kecamatan: 'Gubeng',
        kota: 'Surabaya',
        phone: '6281233285194',
      });

      expect(formText).toContain('Nama Bunda: Jeanetta');
      expect(formText).toContain('Alamat & Shareloc : Gubeng');
      expect(formText).toContain('Kec : Gubeng');
      expect(formText).toContain('Kota : Surabaya');
      expect(formText).toContain('No. Hp : 6281233285194');
    });

    it('asks for shareloc pin after customer submits filled reservation form', async () => {
      const mockCustomer = {
        id: 'cust_backfilled_2',
        phone: '6281233285194',
        name: 'Bunda Jeanetta',
        kelurahan: 'Gubeng',
        kecamatan: 'Gubeng',
        kota: 'Surabaya',
        lat: -7.275,
        lng: 112.755,
        ongkir: 25000,
        share_location_sent: false,
        tenant_id: 'default-tenant',
        status: 'active',
      } as any;

      const mockConversation = {
        id: 'conv_456',
        tenant_id: 'default-tenant',
        customer_id: mockCustomer.id,
        current_state: ConversationState.RESERVATION_SENT,
        last_message_at: new Date(),
        created_at: new Date(),
      } as any;

      const userFilledForm = `Berikut list untuk reservasi :

Hari dan tanggal : Sabtu, 25 Agustus 2026 jam 10.00
Nama Bunda: Jeanetta
Alamat & Shareloc : Jl Kertajaya 4/16
Kec : Gubeng
Kota : Surabaya
No. Hp : 6281233285194

Pilihan treatment (Baby & Kids)
Nama Bayi : Owen
Usia Bayi/Anak : 6 bulan
Treatment : Pijat Bayi Ceria`;

      const { prisma } = await import('../../src/db/client');
      (prisma.reservation as any).create = vi.fn().mockResolvedValue({ id: 'res_123' });
      (prisma.customer as any).update = vi.fn().mockResolvedValue(mockCustomer);

      const ctx = {
        customer: mockCustomer,
        conversation: mockConversation,
        incomingMessage: {
          id: 'msg_2',
          chatId: '6281233285194@c.us',
          from: '6281233285194',
          fromMe: false,
          type: 'chat',
          text: { body: userFilledForm },
          timestamp: Date.now(),
        } as any,
        tenantId: 'default-tenant',
      };

      const result = await handleInterestState(ctx);
      expect(result.nextState).toBe(ConversationState.HUMAN_HANDLING);
      expect(result.replyText).toContain('data reservasi sudah kami terima');
      expect(result.replyText).toContain('share location (pin)');
    });
  });
});
