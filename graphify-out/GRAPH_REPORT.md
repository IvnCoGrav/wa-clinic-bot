# Graph Report - wa-clinic-bot  (2026-07-22)

## Corpus Check
- 57 files · ~32,562 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 300 nodes · 516 edges · 20 communities (18 shown, 2 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 2 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `42d346fa`
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
- ConversationService

## God Nodes (most connected - your core abstractions)
1. `TypingService` - 18 edges
2. `GeocodingService` - 14 edges
3. `ConversationService` - 14 edges
4. `CustomerService` - 14 edges
5. `QueueService` - 14 edges
6. `IWahaClient` - 11 edges
7. `WahaClient` - 11 edges
8. `DeliveryService` - 10 edges
9. `StateHandlerContext` - 10 edges
10. `compilerOptions` - 10 edges

## Surprising Connections (you probably didn't know these)
- `main()` --calls--> `calculateHaversineDistance()`  [EXTRACTED]
  scratch/test_subdistricts.ts → src/utils/haversine.ts
- `buildApp()` --indirect_call--> `adminRoutes()`  [INFERRED]
  src/app.ts → src/routes/admin.route.ts
- `buildApp()` --indirect_call--> `webhookRoutes()`  [INFERRED]
  src/app.ts → src/routes/webhook.route.ts
- `MockWAHAClient` --implements--> `IWahaClient`  [EXTRACTED]
  src/cli/mock-waha-client.ts → src/integrations/waha/client.ts
- `handleGreetingState()` --references--> `TEMPLATES`  [EXTRACTED]
  src/state-machine/handlers/greeting.ts → src/config/persona.ts

## Import Cycles
- None detected.

## Communities (20 total, 2 thin omitted)

### Community 0 - "TypingService"
Cohesion: 0.09
Nodes (8): startSimulator(), MockWAHAClient, IWahaClient, WahaClient, HumanReplyParams, HumanReplyResult, TypingService, ConversationStateMachine

### Community 1 - "scripts"
Cohesion: 0.08
Nodes (24): description, devDependencies, prisma, tsx, @types/node, typescript, vitest, main (+16 more)

### Community 2 - "machine.ts"
Cohesion: 0.36
Nodes (10): BRAND_IDENTITY, TEMPLATES, WhatsAppIncomingMessage, handleGreetingState(), handleHumanHandlingState(), handleInterestState(), handleLocationConfirmationState(), handleLocationState() (+2 more)

### Community 3 - "🔄 2. Histori Perjalanan Revisi (Chronological Revisions History)"
Cohesion: 0.10
Nodes (20): 📌 1. Ikhtisar Project & Tech Stack, 🔄 2. Histori Perjalanan Revisi (Chronological Revisions History), 🗺 3. Alur State Machine (Conversation Orchestrator), 📐 4. Skema Ongkir & Coverage Klinik (Surabaya), 💻 5. CLI Chat Simulator Mode (`npm run chat`), 🧪 6. Verification & Test Suite Summary, 📂 7. Struktur Folder Utama Project, Cara Menjalankan (+12 more)

### Community 4 - "delivery.service.ts"
Cohesion: 0.15
Nodes (13): main(), subdistricts, SubdistrictTest, ClinicConfig, IOrsClient, OrsClient, RouteResult, memoryConversations (+5 more)

### Community 5 - "webhook.route.ts"
Cohesion: 0.14
Nodes (12): buildApp(), globalForPrisma, adminRoutes(), memoryReservations, webhookRoutes(), KnowledgeBaseService, memoryKnowledgeChunks, ParsedReservation (+4 more)

### Community 7 - "generator.ts"
Cohesion: 0.22
Nodes (3): IntentDetectionResult, IntentType, LLMIntentService

### Community 8 - "dependencies"
Cohesion: 0.12
Nodes (17): axios, bullmq, dotenv, fastify, @googlemaps/google-maps-services-js, ioredis, dependencies, axios (+9 more)

### Community 9 - "compilerOptions"
Cohesion: 0.15
Nodes (12): src/**/*, compilerOptions, esModuleInterop, forceConsistentCasingInFileNames, module, moduleResolution, outDir, rootDir (+4 more)

### Community 10 - "GeocodingService"
Cohesion: 0.13
Nodes (8): GeocodingService, googleMapsClient, ResolvedLocation, CustomerService, memoryCustomers, getStringSimilarity(), mockTypingService, testStateMachine

### Community 11 - "⚡ Panduan Setup & Running Lokal"
Cohesion: 0.25
Nodes (7): 1. Environment Variables (`.env`), 2. Jalankan dengan Docker Compose, 3. Endpoints Admin Knowledge Base, ⚡ Panduan Setup & Running Lokal, 📁 Struktur Folder Project, 🛠 Tech Stack, WAHA Clinic Automation Chatbot Engine (Fase 1)

### Community 12 - "whatsapp/types.ts"
Cohesion: 0.25
Nodes (7): WebhookVerificationQuery, WhatsAppLocationPayload, WhatsAppTextPayload, WhatsAppWebhookChange, WhatsAppWebhookEntry, WhatsAppWebhookPayload, WhatsAppWebhookValue

### Community 16 - "WhatsApp Clinic Automation Chatbot"
Cohesion: 0.13
Nodes (14): 1. Latar Belakang & Masalah, 2. Tujuan Produk, 3. Target Pengguna, 4.1 Fase 1 — Conversation Engine (Status: Development selesai, menunggu testing manual), 4.2 Fase 2 — Scheduling & Follow-up Engine (Status: Didesain, belum dikerjakan), 4.3 Di Luar Scope (untuk saat ini), 4. Ruang Lingkup, 5. Alur Percakapan Utama (Ringkasan) (+6 more)

### Community 17 - "QueueService"
Cohesion: 0.21
Nodes (3): QueuePayload, QueueService, stateMachine

### Community 19 - "ConversationService"
Cohesion: 0.17
Nodes (6): WahaLocationPayload, WahaMessagePayload, WahaWebhookEvent, ConversationService, memoryWaMessageIds, MessageService

## Knowledge Gaps
- **97 isolated node(s):** `name`, `version`, `description`, `main`, `build` (+92 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `TypingService` connect `TypingService` to `machine.ts`?**
  _High betweenness centrality (0.052) - this node is a cross-community bridge._
- **Why does `QueueService` connect `QueueService` to `ConversationService`, `webhook.route.ts`?**
  _High betweenness centrality (0.042) - this node is a cross-community bridge._
- **Why does `ConversationService` connect `ConversationService` to `TypingService`, `machine.ts`, `delivery.service.ts`, `webhook.route.ts`, `GeocodingService`?**
  _High betweenness centrality (0.030) - this node is a cross-community bridge._
- **What connects `name`, `version`, `description` to the rest of the system?**
  _97 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `TypingService` be split into smaller, more focused modules?**
  _Cohesion score 0.08846153846153847 - nodes in this community are weakly interconnected._
- **Should `scripts` be split into smaller, more focused modules?**
  _Cohesion score 0.08 - nodes in this community are weakly interconnected._
- **Should `🔄 2. Histori Perjalanan Revisi (Chronological Revisions History)` be split into smaller, more focused modules?**
  _Cohesion score 0.09523809523809523 - nodes in this community are weakly interconnected._