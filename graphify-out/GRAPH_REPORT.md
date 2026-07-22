# Graph Report - wa-clinic-bot  (2026-07-22)

## Corpus Check
- 43 files · ~14,283 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 236 nodes · 386 edges · 16 communities (15 shown, 1 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 2 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `8869ea8e`
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

## God Nodes (most connected - your core abstractions)
1. `TypingService` - 18 edges
2. `ConversationService` - 13 edges
3. `IWahaClient` - 11 edges
4. `WahaClient` - 11 edges
5. `compilerOptions` - 10 edges
6. `🔄 2. Histori Perjalanan Revisi (Chronological Revisions History)` - 10 edges
7. `scripts` - 9 edges
8. `GeocodingService` - 9 edges
9. `CustomerService` - 8 edges
10. `StateHandlerContext` - 8 edges

## Surprising Connections (you probably didn't know these)
- `buildApp()` --indirect_call--> `adminRoutes()`  [INFERRED]
  src/app.ts → src/routes/admin.route.ts
- `buildApp()` --indirect_call--> `webhookRoutes()`  [INFERRED]
  src/app.ts → src/routes/webhook.route.ts
- `MockWAHAClient` --implements--> `IWahaClient`  [EXTRACTED]
  src/cli/mock-waha-client.ts → src/integrations/waha/client.ts
- `DeliveryService` --references--> `IOrsClient`  [EXTRACTED]
  src/services/delivery.service.ts → src/integrations/ors/client.ts
- `TypingService` --references--> `IWahaClient`  [EXTRACTED]
  src/services/typing.service.ts → src/integrations/waha/client.ts

## Import Cycles
- None detected.

## Communities (16 total, 1 thin omitted)

### Community 0 - "TypingService"
Cohesion: 0.09
Nodes (8): startSimulator(), MockWAHAClient, IWahaClient, WahaClient, HumanReplyParams, HumanReplyResult, TypingService, ConversationStateMachine

### Community 1 - "scripts"
Cohesion: 0.08
Nodes (24): description, devDependencies, prisma, tsx, @types/node, typescript, vitest, main (+16 more)

### Community 2 - "machine.ts"
Cohesion: 0.25
Nodes (10): ClinicConfig, WhatsAppIncomingMessage, ConversationService, memoryConversations, handleGreetingState(), handleHumanHandlingState(), handleInterestState(), handleLocationState() (+2 more)

### Community 3 - "🔄 2. Histori Perjalanan Revisi (Chronological Revisions History)"
Cohesion: 0.10
Nodes (20): 📌 1. Ikhtisar Project & Tech Stack, 🔄 2. Histori Perjalanan Revisi (Chronological Revisions History), 🗺 3. Alur State Machine (Conversation Orchestrator), 📐 4. Skema Ongkir & Coverage Klinik (Surabaya), 💻 5. CLI Chat Simulator Mode (`npm run chat`), 🧪 6. Verification & Test Suite Summary, 📂 7. Struktur Folder Utama Project, Cara Menjalankan (+12 more)

### Community 4 - "delivery.service.ts"
Cohesion: 0.21
Nodes (8): IOrsClient, OrsClient, RouteResult, DeliveryCalculationResult, DeliveryService, calculateHaversineDistance(), Coordinates, toRadians()

### Community 5 - "webhook.route.ts"
Cohesion: 0.19
Nodes (9): buildApp(), WahaLocationPayload, WahaMessagePayload, WahaWebhookEvent, adminRoutes(), webhookRoutes(), CustomerService, memoryCustomers (+1 more)

### Community 6 - "knowledge.service.ts"
Cohesion: 0.17
Nodes (6): globalForPrisma, KnowledgeBaseService, memoryKnowledgeChunks, memoryWaMessageIds, MessageService, chunkTextDocument()

### Community 7 - "generator.ts"
Cohesion: 0.19
Nodes (6): BOT_PERSONA_PROMPT, LLMResponseGenerator, IntentDetectionResult, IntentType, LLMIntentService, KnowledgeChunkResult

### Community 8 - "dependencies"
Cohesion: 0.15
Nodes (13): axios, dotenv, fastify, @googlemaps/google-maps-services-js, dependencies, axios, dotenv, fastify (+5 more)

### Community 9 - "compilerOptions"
Cohesion: 0.15
Nodes (12): src/**/*, compilerOptions, esModuleInterop, forceConsistentCasingInFileNames, module, moduleResolution, outDir, rootDir (+4 more)

### Community 10 - "GeocodingService"
Cohesion: 0.29
Nodes (3): GeocodingService, googleMapsClient, ResolvedLocation

### Community 11 - "⚡ Panduan Setup & Running Lokal"
Cohesion: 0.25
Nodes (7): 1. Environment Variables (`.env`), 2. Jalankan dengan Docker Compose, 3. Endpoints Admin Knowledge Base, ⚡ Panduan Setup & Running Lokal, 📁 Struktur Folder Project, 🛠 Tech Stack, WAHA Clinic Automation Chatbot Engine (Fase 1)

### Community 12 - "whatsapp/types.ts"
Cohesion: 0.25
Nodes (7): WebhookVerificationQuery, WhatsAppLocationPayload, WhatsAppTextPayload, WhatsAppWebhookChange, WhatsAppWebhookEntry, WhatsAppWebhookPayload, WhatsAppWebhookValue

## Knowledge Gaps
- **75 isolated node(s):** `name`, `version`, `description`, `main`, `build` (+70 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `TypingService` connect `TypingService` to `machine.ts`?**
  _High betweenness centrality (0.063) - this node is a cross-community bridge._
- **Why does `ConversationService` connect `machine.ts` to `TypingService`, `webhook.route.ts`?**
  _High betweenness centrality (0.036) - this node is a cross-community bridge._
- **What connects `name`, `version`, `description` to the rest of the system?**
  _75 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `TypingService` be split into smaller, more focused modules?**
  _Cohesion score 0.08846153846153847 - nodes in this community are weakly interconnected._
- **Should `scripts` be split into smaller, more focused modules?**
  _Cohesion score 0.08 - nodes in this community are weakly interconnected._
- **Should `🔄 2. Histori Perjalanan Revisi (Chronological Revisions History)` be split into smaller, more focused modules?**
  _Cohesion score 0.09523809523809523 - nodes in this community are weakly interconnected._