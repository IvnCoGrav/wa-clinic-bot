# Implementation Plan — Penegakan Mandat Mutlak Larangan Menyentuh Label WAHA, Dekoupling WhatsApp Gateway, & Resolusi Flaky Test (Issue #38)

Dokumen ini merinci rencana implementasi arsitektur fondasional tahap ke-5: menegakkan secara tuntas **Mandat Mutlak Larangan Menyentuh Label WAHA** (aturan fundamental di `AGENTS.md`), membersihkan seluruh residu pemanggilan `wahaClient.addLabel` / `removeLabel` dari kode produksi menjadi penandaan internal basis data murni (*internal database tagging*), memigrasikan panggilan WAHA langsung ke abstraksi `getGateway(tenantId)`, serta menyelesaikan *flaky test* kebocoran mock label pada suite pengujian (**Known Issue #38**).

---

## 📌 Root Cause Analysis & Masalah Desain Sistemik

### 1. Pelanggaran Mandat Mutlak Larangan Menyentuh Label WAHA
- **Dasar Aturan (`AGENTS.md`)**:
  > *"Larangan Menyentuh Label WAHA (MANDATORY): DILARANG KERAS memanggil atau memodifikasi label WhatsApp di WAHA (seperti `wahaClient.addLabel`, `removeLabel`, atau sinkronisasi label WAHA lainnya). Seluruh penandaan label, tag, atau status (seperti 'tanya jadwal', MQL, status percakapan) HANYA BOLEH dilakukan di level internal sistem / database (tabel Customer, session DB, atau livechat internal tag), BUKAN ke WAHA."*
- **Akar Masalah di Lapisan Produksi**:
  Meskipun aturan ini telah dinyatakan mutlak, masih ditemukan 12 titik pemanggilan langsung `wahaClient.addLabel` di berbagai modul runtime warisan:
  1. [src/services/conversation.service.ts](file:///c:/Users/User/Documents/chatbot%20AG/src/services/conversation.service.ts#L440): `wahaClient.addLabel(`${phone}@c.us`, 'hold')` saat eskalasi manual.
  2. [src/services/label-reconciliation.service.ts](file:///c:/Users/User/Documents/chatbot%20AG/src/services/label-reconciliation.service.ts#L77-L103): `wahaClient.addLabel(chatId, 'repeat')` dan `'pending payment'`.
  3. [src/routes/webhook.route.ts](file:///c:/Users/User/Documents/chatbot%20AG/src/routes/webhook.route.ts#L907-L934): `wahaClient.addLabel(chatId, 'hold')` dan `'new customer'`.
  4. [src/routes/admin/livechat.subroute.ts](file:///c:/Users/User/Documents/chatbot%20AG/src/routes/admin/livechat.subroute.ts#L790): `wahaClient.addLabel(..., 'hold')`.
  5. [src/services/per-contact-legacy-scrape.service.ts](file:///c:/Users/User/Documents/chatbot%20AG/src/services/per-contact-legacy-scrape.service.ts#L121): `wahaClient.addLabel(chatId, 'legacy')`.
- **Dampak Bahaya di Produksi**:
  1. Menimbulkan lonjakan HTTP request lambat ke container WAHA yang berisiko memicu *rate limiting* atau memblokir session WhatsApp Web.
  2. Menyebabkan ketidakkonsistenan label ketika instance WAHA di-restart atau di-reconnect (status label di WAHA tidak memiliki integritas transaksional ACID seperti PostgreSQL).
  3. Memperkenalkan titik kegagalan (*single point of failure*) pada alur webhook utama ketika endpoint label WAHA timeout.
- **Solusi Fondasional**:
  - Hapus seluruh pemanggilan `wahaClient.addLabel` dan `removeLabel` dari seluruh kode servis dan webhook.
  - Alihkan seluruh mutasi status label (seperti `'hold'`, `'repeat'`, `'new customer'`, `'pending payment'`) ke kolom `customer.labels` dan `conversation.is_human_handling` di basis data PostgreSQL.

### 2. Flaky Test pada `production_edge_cases.test.ts` #28 (Known Issue #38)
- **Lokasi**: [tests/unit/production_edge_cases.test.ts](file:///c:/Users/User/Documents/chatbot%20AG/tests/unit/production_edge_cases.test.ts) & [docs/KNOWN_ISSUES.md](file:///c:/Users/User/Documents/chatbot%20AG/docs/KNOWN_ISSUES.md#L940)
- **Akar Masalah**:
  1. Test #28 (*should auto-resume bot handling when webhook receives message and hold label is missing from WAHA*) mengandalkan mock `getChatLabels`.
  2. Saat dijalankan bersamaan dalam `npm test` full-suite (paralel antar-file), state mock WAHA bocor dari file pengujian lain yang memanipulasi `wahaClient`. Akibatnya, `getChatLabels` mengembalikan array kosong sehingga test gagal intermiten.
  3. Menguji logika bot berdasarkan ada/tidaknya label di WAHA bertentangan dengan arsitektur internal di mana bot handling ditentukan oleh `is_human_handling` di DB, bukan label WAHA.
- **Solusi Fondasional**:
  - Alihkan assertions test #28 untuk menguji `activeConversation.is_human_handling` dan status database internal.
  - Tambahkan isolasi scoped sandbox mock per-test file (`describe.sequential` / `beforeEach` scoped cleanup).

---

## 🏛️ Arsitektur Labeling Internal (Internal DB-Driven vs Zero WAHA Mutation)

```mermaid
flowchart TD
    Inbound[Pesan WhatsApp Masuk] --> Webhook[webhook.route.ts / machine.ts]

    subgraph DBMutasi [Level Internal Sistem / Database (MANDATORY)]
        Webhook --> CheckCustomer{Customer Baru?}
        CheckCustomer -- Ya --> MarkDBCust[Update PostgreSQL: customer.labels += 'new customer']
        Webhook --> Escalation{Butuh Eskalasi / Hold?}
        Escalation -- Ya --> MarkDBConv[Update PostgreSQL: conversation.is_human_handling = true]
        MarkDBConv --> TelegramAlert[Kirim Notifikasi Internal CS / Telegram]
    end

    subgraph WAHAStrictlyBanned [WAHA HTTP API (ZERO MUTATION)]
        MarkDBCust -. DILARANG KERAS! .-> WAHALabelCall[wahaClient.addLabel / removeLabel]
        MarkDBConv -. DILARANG KERAS! .-> WAHALabelCall
    end

    classDef allowed fill:#0f172a,stroke:#10b981,color:#fff;
    classDef banned fill:#7f1d1d,stroke:#ef4444,color:#fca5a5,stroke-dasharray: 5 5;
    class Inbound,Webhook,MarkDBCust,MarkDBConv,TelegramAlert allowed;
    class WAHALabelCall banned;
```

---

## 🛠️ Staged Implementation Phases

### Phase 1: Pembersihan Pemanggilan Label WAHA di Servis Inti
**Tujuan**: Menghentikan seluruh penulisan label ke WAHA dari lapisan servis bisnis.

#### [MODIFY] [conversation.service.ts](file:///c:/Users/User/Documents/chatbot%20AG/src/services/conversation.service.ts)
- Pada baris ~440:
  ```diff
  - await wahaClient.addLabel(`${phone}@c.us`, 'hold').catch((err: any) => console.warn(`[LABEL ERROR] Failed to auto-add hold label:`, err.message));
  + // Mandat Anti-Label WAHA: penandaan hold dilakukan via status is_human_handling di DB internal
  + console.log(`[ESCALATION DB] Customer ${phone} dialihkan ke penanganan manusia (DB only, zero WAHA label).`);
  ```

#### [MODIFY] [label-reconciliation.service.ts](file:///c:/Users/User/Documents/chatbot%20AG/src/services/label-reconciliation.service.ts)
- Hapus pemanggilan `wahaClient.addLabel(chatId, 'repeat')` dan `wahaClient.addLabel(chatId, 'pending payment')`.
- Gantikan dengan pembaruan array `customer.labels` di PostgreSQL (`prisma.customer.update`).

#### [MODIFY] [per-contact-legacy-scrape.service.ts](file:///c:/Users/User/Documents/chatbot%20AG/src/services/per-contact-legacy-scrape.service.ts)
- Hapus pemanggilan `wahaClient.addLabel(chatId, 'legacy')`.
- Tandai customer lewat kolom boolean `customer.is_legacy_source = true` di database.

---

### Phase 2: Pembersihan Pemanggilan Label WAHA di Webhook & Admin Routes
**Tujuan**: Menghilangkan mutasi label WAHA di controller HTTP dan webhook listener.

#### [MODIFY] [webhook.route.ts](file:///c:/Users/User/Documents/chatbot%20AG/src/routes/webhook.route.ts)
- Di baris ~907 dan ~933:
  - Hapus `wahaClient.addLabel(chatId, 'hold')`.
  - Hapus `wahaClient.addLabel(chatId, 'new customer')`.
  - Pastikan penandaan customer baru tersimpan di kolom internal `customer.labels` secara aman via `customerService`.

#### [MODIFY] [livechat.subroute.ts](file:///c:/Users/User/Documents/chatbot%20AG/src/routes/admin/livechat.subroute.ts) & [customers.subroute.ts](file:///c:/Users/User/Documents/chatbot%20AG/src/routes/admin/customers.subroute.ts)
- Hapus seluruh pemanggilan `wahaClient.addLabel` dan `wahaClient.removeLabel`.
- Operasi label dari UI dashboard admin murni memanipulasi kolom `labels` pada tabel `Customer` di database.

---

### Phase 3: Penegakan Invariant Guard & Gatekeeping
**Tujuan**: Menjamin tidak ada developer atau kode baru yang memanggil mutasi label WAHA.

#### [NEW] `tests/unit/v3/waha-label-ban-invariant.test.ts`
- Buat pengujian pemindai statis AST / ripgrep:
  ```ts
  it('DILARANG memanggil wahaClient.addLabel atau removeLabel di seluruh src/', () => {
    // Memindai src/ (kecuali waha/client.ts itu sendiri):
    // Memastikan 0 kemunculan wahaClient.addLabel / removeLabel di kode bisnis & webhook!
  });
  ```

#### [MODIFY] [waha/client.ts](file:///c:/Users/User/Documents/chatbot%20AG/src/integrations/waha/client.ts)
- Tambahkan logging guard `[MANDAT WAHA LABEL VIOLATION]` atau *soft-deprecation warning* jika metode `addLabel`/`removeLabel` terpanggil di runtime.

---

### Phase 4: Resolusi Flaky Test `production_edge_cases.test.ts` (Issue #38)
**Tujuan**: Menghilangkan kegagalan intermiten test #28 pada full-suite run.

#### [MODIFY] [production_edge_cases.test.ts](file:///c:/Users/User/Documents/chatbot%20AG/tests/unit/production_edge_cases.test.ts)
1. Perbaiki test #28:
   - Hubungkan verifikasi dengan status database `conversation.is_human_handling` alih-alih polling mock label WAHA.
2. Tambahkan `describe.sequential` pada blok pengujian webhook/edge cases untuk mencegah kebocoran state mock di lingkungan multithread/paralel Vitest.

---

### Phase 5: Penutupan Issue #38 di `docs/KNOWN_ISSUES.md`
#### [MODIFY] [docs/KNOWN_ISSUES.md](file:///c:/Users/User/Documents/chatbot%20AG/docs/KNOWN_ISSUES.md)
- Perbarui status **Issue #38** (`production_edge_cases.test.ts #28 flaky pada run paralel`) menjadi `RESOLVED`.
- Catat penegakan fondasional **Mandat Mutlak Larangan Menyentuh Label WAHA** di seluruh codebase.

---

## 🧪 Verification Plan & Regression Gate

### Automated Tests
1. **Invariant Scanner**:
   - `npx vitest run tests/unit/v3/waha-label-ban-invariant.test.ts` (0 pelanggaran pemanggilan label WAHA).
2. **Edge Cases Test Suite**:
   - `npx vitest run tests/unit/production_edge_cases.test.ts` (12/12 passed tanpa flakiness).
3. **Webhook & Machine Integration**:
   - `npx vitest run tests/unit/webhook.test.ts`
   - `npx vitest run tests/unit/machine.test.ts`
4. **Full Regression Suite**:
   - `npx vitest run` (263/263 test files green).
   - `npm run build` (`tsc` exit 0).
