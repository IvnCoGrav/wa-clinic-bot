# Graph Report - wa-clinic-bot  (2026-07-23)

## Corpus Check
- 68 files · ~44,946 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 365 nodes · 654 edges · 21 communities (16 shown, 5 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 2 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `38b0a965`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- TypingService
- scripts
- machine.ts
- 🔄 2. Histori Perjalanan Revisi (Chronological Revisions History)
- delivery.service.ts
- webhook.route.ts
- knowledge.service.ts
- generator.ts
- dependencies
- compilerOptions
- GeocodingService
- ⚡ Panduan Setup & Running Lokal
- whatsapp/types.ts
- WhatsAppClient
- WhatsApp Clinic Automation Chatbot
- QueueService
- treatment-catalog.service.ts
- LLMResponseGenerator

## God Nodes (most connected - your core abstractions)
1. `WahaClient` - 23 edges
2. `CustomerService` - 19 edges
3. `TypingService` - 18 edges
4. `ConversationService` - 16 edges
5. `IWahaClient` - 15 edges
6. `GeocodingService` - 14 edges
7. `QueueService` - 14 edges
8. `WhatsApp Clinic Automation Chatbot` - 12 edges
9. `MockWAHAClient` - 11 edges
10. `scripts` - 10 edges

## Surprising Connections (you probably didn't know these)
- `main()` --calls--> `calculateHaversineDistance()`  [EXTRACTED]
  scratch/test_subdistricts.ts → src/utils/haversine.ts
- `main()` --references--> `@prisma/client`  [EXTRACTED]
  src/cli/reset-customer.ts → package.json
- `buildApp()` --indirect_call--> `adminRoutes()`  [INFERRED]
  src/app.ts → src/routes/admin.route.ts
- `buildApp()` --indirect_call--> `webhookRoutes()`  [INFERRED]
  src/app.ts → src/routes/webhook.route.ts
- `MockWAHAClient` --implements--> `IWahaClient`  [EXTRACTED]
  src/cli/mock-waha-client.ts → src/integrations/waha/client.ts

## Import Cycles
- None detected.

## Communities (21 total, 5 thin omitted)

### Community 0 - "TypingService"
Cohesion: 0.08
Nodes (7): startSimulator(), MockWAHAClient, IWahaClient, HumanReplyParams, HumanReplyResult, TypingService, ConversationStateMachine

### Community 2 - "machine.ts"
Cohesion: 0.25
Nodes (13): BRAND_IDENTITY, TEMPLATES, WhatsAppIncomingMessage, memoryConversations, QueuePayload, handleGreetingState(), handleHumanHandlingState(), handleInterestState() (+5 more)

### Community 3 - "🔄 2. Histori Perjalanan Revisi (Chronological Revisions History)"
Cohesion: 0.10
Nodes (20): 📌 1. Ikhtisar Project & Tech Stack, 🔄 2. Histori Perjalanan Revisi (Chronological Revisions History), 🗺 3. Alur State Machine (Conversation Orchestrator), 📐 4. Skema Ongkir & Coverage Klinik (Surabaya), 💻 5. CLI Chat Simulator Mode (`npm run chat`), 🧪 6. Verification & Test Suite Summary, 📂 7. Struktur Folder Utama Project, Cara Menjalankan (+12 more)

### Community 4 - "delivery.service.ts"
Cohesion: 0.16
Nodes (12): main(), subdistricts, SubdistrictTest, ClinicConfig, IOrsClient, OrsClient, RouteResult, DeliveryCalculationResult (+4 more)

### Community 5 - "webhook.route.ts"
Cohesion: 0.10
Nodes (11): buildApp(), WahaLocationPayload, WahaMessagePayload, WahaWebhookEvent, webhookRoutes(), AbuseDetectionService, ConversationService, CustomerService (+3 more)

### Community 6 - "knowledge.service.ts"
Cohesion: 0.11
Nodes (14): faqs, globalForPrisma, adminRoutes(), memoryReservations, safeCompare(), KnowledgeBaseService, memoryKnowledgeChunks, AdminReplyBuffer (+6 more)

### Community 8 - "dependencies"
Cohesion: 0.04
Nodes (44): axios, bullmq, dotenv, fastify, @googlemaps/google-maps-services-js, ioredis, dependencies, axios (+36 more)

### Community 9 - "compilerOptions"
Cohesion: 0.15
Nodes (12): src/**/*, compilerOptions, esModuleInterop, forceConsistentCasingInFileNames, module, moduleResolution, outDir, rootDir (+4 more)

### Community 10 - "GeocodingService"
Cohesion: 0.11
Nodes (9): GeocodingService, googleMapsClient, ResolvedLocation, IntentDetectionResult, IntentType, LLMIntentService, getStringSimilarity(), mockTypingService (+1 more)

### Community 11 - "⚡ Panduan Setup & Running Lokal"
Cohesion: 0.25
Nodes (7): 1. Environment Variables (`.env`), 2. Jalankan dengan Docker Compose, 3. Endpoints Admin Knowledge Base, ⚡ Panduan Setup & Running Lokal, 📁 Struktur Folder Project, 🛠 Tech Stack, WAHA Clinic Automation Chatbot Engine (Fase 1)

### Community 12 - "whatsapp/types.ts"
Cohesion: 0.25
Nodes (7): WebhookVerificationQuery, WhatsAppLocationPayload, WhatsAppTextPayload, WhatsAppWebhookChange, WhatsAppWebhookEntry, WhatsAppWebhookPayload, WhatsAppWebhookValue

### Community 16 - "WhatsApp Clinic Automation Chatbot"
Cohesion: 0.11
Nodes (18): 10. Batasan & Risiko yang Diketahui, 11. Kriteria Selesai (Definition of Done) Fase 1, 1. Latar Belakang & Masalah, 2. Tujuan Produk, 3. Target Pengguna, 4.1.1 Fitur Tambahan "Fase 3" (Status: Development & Verification Selesai), 4.1 Fase 1 — Conversation Engine (Status: Development selesai, menunggu testing manual), 4.2 Fase 2 — Scheduling & Follow-up Engine (Status: Didesain, belum dikerjakan) (+10 more)

### Community 19 - "treatment-catalog.service.ts"
Cohesion: 0.19
Nodes (6): AgeTier, ClinicServiceItem, DEFAULT_CLINIC_SERVICES, serviceCatalog, TreatmentCatalogService, TreatmentCategoryType

## Knowledge Gaps
- **109 isolated node(s):** `name`, `version`, `description`, `main`, `build` (+104 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `WahaClient` connect `generator.ts` to `TypingService`, `machine.ts`, `GeocodingService`, `webhook.route.ts`?**
  _High betweenness centrality (0.067) - this node is a cross-community bridge._
- **Why does `adminRoutes()` connect `knowledge.service.ts` to `treatment-catalog.service.ts`, `webhook.route.ts`?**
  _High betweenness centrality (0.051) - this node is a cross-community bridge._
- **Why does `TypingService` connect `TypingService` to `machine.ts`?**
  _High betweenness centrality (0.039) - this node is a cross-community bridge._
- **What connects `name`, `version`, `description` to the rest of the system?**
  _109 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `TypingService` be split into smaller, more focused modules?**
  _Cohesion score 0.08170731707317073 - nodes in this community are weakly interconnected._
- **Should `🔄 2. Histori Perjalanan Revisi (Chronological Revisions History)` be split into smaller, more focused modules?**
  _Cohesion score 0.09523809523809523 - nodes in this community are weakly interconnected._
- **Should `webhook.route.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.09982174688057041 - nodes in this community are weakly interconnected._