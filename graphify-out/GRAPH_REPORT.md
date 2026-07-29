# Graph Report - wa-clinic-bot  (2026-07-29)

## Corpus Check
- 305 files · ~186,804 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2047 nodes · 3022 edges · 171 communities (146 shown, 25 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 73 edges (avg confidence: 0.53)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `022e19cd`
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
- admin.route.ts
- LLMIntentService
- waha/types.ts
- reset-customer.ts
- seed-faq.ts
- similarity.ts
- BroadcastQueueService
- install.js
- backup.sh
- caveman/.agents/skills/caveman-compress/scripts/validate.py
- plugins/caveman/skills/caveman-compress/scripts/validate.py
- caveman/skills/caveman-compress/scripts/validate.py
- .agents/skills/caveman-compress/scripts/validate.py
- caveman/agents/cavecrew-investigator.md
- .agents/skills/caveman-compress/scripts/compress.py
- ModeTrackerTests
- caveman/package.json
- caveman-stats.js
- caveman-shrink/package.json
- CLAUDE.md — caveman
- settings.js
- .agents/skills/caveman-compress/README.md
- caveman/.agents/skills/caveman-compress/README.md
- caveman/skills/caveman-compress/README.md
- index.js
- click-catcher/package.json
- CustomerService
- caveman-config.js
- caveman-mode-tracker.js
- verify_repo.py
- test_cavecrew_model_overrides.js
- openclaw.js
- CLAUDE.md — Taskflow Project
- CLAUDE.md — Taskflow Project
- RTK Commands by Workflow
- .agents/skills/cavecrew/SKILL.md
- Caveman Help
- caveman/.agents/skills/cavecrew/SKILL.md
- Caveman Help
- Caveman Help
- compilerOptions
- run.py
- caveman/README.md
- e2e.freshinstall.test.mjs
- TypingService
- Caveman Compress
- .agents/skills/caveman/SKILL.md
- Caveman Compress
- caveman/.agents/skills/caveman/SKILL.md
- Contributing to caveman
- Privacy & Telemetry
- Caveman Compress
- Caveman Compress
- plugin.js
- caveman-commit
- caveman-review
- caveman-commit
- caveman-review
- caveman-commit
- caveman-review
- caveman-init.js
- test_caveman_stats.js
- DetectFileTypeTests
- devDependencies
- Click Catcher Microservice
- caveman-activate.js
- opencode.test.mjs
- test_caveman_init.js
- CompressSafetyTests
- HookScriptTests
- Evals
- Install caveman
- Caveman Hooks
- test_mode_tracker_stdin.js
- marketplace.json
- caveman/skills/caveman/SKILL.md
- caveman-shrink
- API Integration Guide
- API Integration Guide
- hermes.test.mjs
- test_mcp_shrink.js
- caveman-stats
- caveman-stats
- Contributor Covenant Code of Conduct
- Honest Numbers
- plugins/caveman/agents/cavecrew-investigator.md
- plugins/caveman/skills/cavecrew/SKILL.md
- caveman-stats
- opencode/package.json
- User Preferences
- User Preferences
- Project Notes — Taskflow
- Project Notes — Taskflow
- opencode-agent.test.mjs
- BroadcastQueueService
- measure.py
- plugins/caveman/agents/cavecrew-builder.md
- plugins/caveman/agents/cavecrew-reviewer.md
- plugins/caveman/skills/caveman/SKILL.md
- caveman
- caveman — opencode plugin
- Sprint 24 — Task List
- Sprint 24 — Task List
- slash-commands.test.mjs
- RTK - Rust Token Killer (Google Antigravity)
- Windows install fallback
- llm_run.py
- ps1-pipe.test.mjs
- package.json
- @prisma/client
- plot.py
- e2e.dryrun.test.mjs
- unit.argv.test.mjs
- server.ts
- .agents/skills/caveman-compress/scripts/__init__.py
- caveman/.agents/skills/caveman-compress/scripts/__init__.py
- install.sh script
- plugins/caveman/skills/caveman-compress/scripts/__init__.py
- caveman/skills/caveman-compress/scripts/__init__.py
- caveman-statusline.sh script
- install.sh script
- hooks/package.json
- uninstall.sh script
- caveman-openclaw-bootstrap.md
- @fastify/rate-limit
- @types/sanitize-html
- zod

## God Nodes (most connected - your core abstractions)
1. `WahaClient` - 34 edges
2. `ModeTrackerTests` - 28 edges
3. `CustomerService` - 26 edges
4. `ConversationService` - 21 edges
5. `TypingService` - 21 edges
6. `main()` - 20 edges
7. `IWahaClient` - 18 edges
8. `QueueService` - 18 edges
9. `main()` - 17 edges
10. `buildApp()` - 17 edges

## Surprising Connections (you probably didn't know these)
- `TestExtractInlineCodes` --uses--> `ValidationResult`  [INFERRED]
  caveman/tests/test_validate_inline.py → .agents/skills/caveman-compress/scripts/validate.py
- `TestValidateInlineCodes` --uses--> `ValidationResult`  [INFERRED]
  caveman/tests/test_validate_inline.py → .agents/skills/caveman-compress/scripts/validate.py
- `TestValidateIntegration` --uses--> `ValidationResult`  [INFERRED]
  caveman/tests/test_validate_inline.py → .agents/skills/caveman-compress/scripts/validate.py
- `main()` --calls--> `calculateHaversineDistance()`  [EXTRACTED]
  scratch/test_subdistricts.ts → src/utils/haversine.ts
- `main()` --references--> `@prisma/client`  [EXTRACTED]
  src/cli/reset-customer.ts → package.json

## Import Cycles
- None detected.

## Communities (171 total, 25 thin omitted)

### Community 0 - "TypingService"
Cohesion: 0.07
Nodes (4): startSimulator(), MockWAHAClient, IWahaClient, TypingService

### Community 2 - "machine.ts"
Cohesion: 0.23
Nodes (14): BRAND_IDENTITY, TEMPLATES, WhatsAppIncomingMessage, BroadcastJobData, QueuePayload, handleGreetingState(), handleHumanHandlingState(), handleInterestState() (+6 more)

### Community 3 - "🔄 2. Histori Perjalanan Revisi (Chronological Revisions History)"
Cohesion: 0.10
Nodes (20): 📌 1. Ikhtisar Project & Tech Stack, 🔄 2. Histori Perjalanan Revisi (Chronological Revisions History), 🗺 3. Alur State Machine (Conversation Orchestrator), 📐 4. Skema Ongkir & Coverage Klinik (Surabaya), 💻 5. CLI Chat Simulator Mode (`npm run chat`), 🧪 6. Verification & Test Suite Summary, 📂 7. Struktur Folder Utama Project, Cara Menjalankan (+12 more)

### Community 4 - "delivery.service.ts"
Cohesion: 0.17
Nodes (12): main(), subdistricts, SubdistrictTest, ClinicConfig, IOrsClient, OrsClient, RouteResult, DeliveryCalculationResult (+4 more)

### Community 5 - "webhook.route.ts"
Cohesion: 0.12
Nodes (7): WahaChat, WahaMessage, AbuseDetectionService, ConversationService, memoryConversations, CustomerService, memoryCustomers

### Community 6 - "knowledge.service.ts"
Cohesion: 0.08
Nodes (14): faqs, LLMResponseGenerator, capiBreaker, CapiService, normalizePhoneToE164(), sha256Hash(), KnowledgeBaseService, KnowledgeChunkResult (+6 more)

### Community 7 - "generator.ts"
Cohesion: 0.13
Nodes (3): WahaClient, HumanReplyParams, HumanReplyResult

### Community 8 - "dependencies"
Cohesion: 0.18
Nodes (11): scripts, build, chat, dev, prisma:generate, prisma:migrate, scrape:all, seed:faq (+3 more)

### Community 9 - "compilerOptions"
Cohesion: 0.15
Nodes (12): compilerOptions, esModuleInterop, forceConsistentCasingInFileNames, module, moduleResolution, outDir, rootDir, skipLibCheck (+4 more)

### Community 10 - "GeocodingService"
Cohesion: 0.25
Nodes (7): WebhookVerificationQuery, WhatsAppLocationPayload, WhatsAppTextPayload, WhatsAppWebhookChange, WhatsAppWebhookEntry, WhatsAppWebhookPayload, WhatsAppWebhookValue

### Community 11 - "⚡ Panduan Setup & Running Lokal"
Cohesion: 0.22
Nodes (8): 1. Environment Variables (`.env`), 2. Jalankan WAHA Docker (NOWEB Engine), 3. Endpoints Admin Knowledge Base, 3. Jalankan Aplikasi dengan Docker Compose, ⚡ Panduan Setup & Running Lokal, 📁 Struktur Folder Project, 🛠 Tech Stack, WAHA Clinic Automation Chatbot Engine (Fase 1)

### Community 12 - "whatsapp/types.ts"
Cohesion: 0.12
Nodes (17): axios, bullmq, @fastify/rate-limit, googleapis, @googlemaps/google-maps-services-js, ioredis, dependencies, axios (+9 more)

### Community 16 - "WhatsApp Clinic Automation Chatbot"
Cohesion: 0.11
Nodes (18): 10. Batasan & Risiko yang Diketahui, 11. Kriteria Selesai (Definition of Done) Fase 1, 1. Latar Belakang & Masalah, 2. Tujuan Produk, 3. Target Pengguna, 4.1.1 Fitur Tambahan "Fase 3" (dikerjakan di sesi terpisah — status: perlu klarifikasi sebelum dianggap selesai), 4.1 Fase 1 — Conversation Engine (Status: Development selesai, menunggu testing manual), 4.2 Fase 2 — Scheduling & Follow-up Engine (Status: Didesain, belum dikerjakan) (+10 more)

### Community 17 - "QueueService"
Cohesion: 0.10
Nodes (7): AlertPayload, AlertService, AlertSeverity, AlertType, QueueService, hashPiiPhone(), sanitizeLogPayload()

### Community 19 - "treatment-catalog.service.ts"
Cohesion: 0.06
Nodes (24): AiModelConfigService, AiTaskModelConfig, AiTaskType, defaultTaskModelRegistry, checkMedicalKeywords(), HIGH_SEVERITY_MEDICAL_KEYWORDS, MEDIUM_SEVERITY_MEDICAL_KEYWORDS, adminRoutes() (+16 more)

### Community 20 - "admin.route.ts"
Cohesion: 0.13
Nodes (11): memoryReservations, generateTrackingCode(), memoryAdClicks, pruneMemoryMap(), _randomCode(), RETRY_LENGTHS, trackingRoutes(), AuditService (+3 more)

### Community 22 - "waha/types.ts"
Cohesion: 0.08
Nodes (24): [1.0.0] — 2026-07-20, [1.1.0] — 2026-07-21, [1.2.0] — 2026-07-22, [1.3.0] — 2026-07-23, [1.4.0] — 2026-07-24, [1.5.0] — 2026-07-25, Added — Ad Click Attribution & Meta Conversions API (CAPI), Added — Click Catcher Microservice (`wa-click-catcher`) (+16 more)

### Community 23 - "reset-customer.ts"
Cohesion: 0.44
Nodes (11): detect_arch(), detect_os(), error(), get_latest_version(), get_target(), info(), install(), main() (+3 more)

### Community 24 - "seed-faq.ts"
Cohesion: 0.25
Nodes (7): 💾 1. Mekanisme Backup Otomatis, 🔄 2. Langkah Pemulihan 3 Tahap (Disaster Recovery), Konfigurasi Cron Job di VPS Linux (Tiap 6 Jam), Panduan Backup & Pemulihan Sistem (Disaster Recovery), Tahap 1: Ekstrak Konfigurasi dan Aset, Tahap 2: Pemulihan Database PostgreSQL, Tahap 3: Memulai Ulang Service Chatbot

### Community 25 - "similarity.ts"
Cohesion: 0.17
Nodes (8): GeocodingService, googleMapsClient, ResolvedLocation, IntentDetectionResult, IntentType, getStringSimilarity(), mockTypingService, testStateMachine

### Community 26 - "BroadcastQueueService"
Cohesion: 0.17
Nodes (3): globalForPrisma, CronService, FollowUpService

### Community 27 - "install.js"
Cohesion: 0.07
Nodes (61): absoluteNodePath(), captureSpawn(), checkNodeVersion(), checkWslWindowsNode(), child_process, copyDirRecursive(), crypto, cursorExtPresent() (+53 more)

### Community 29 - "caveman/.agents/skills/caveman-compress/scripts/validate.py"
Cohesion: 0.07
Nodes (49): benchmark_pair(), count_tokens(), main(), print_table(), Path, main(), print_usage(), backup_dir_for() (+41 more)

### Community 30 - "plugins/caveman/skills/caveman-compress/scripts/validate.py"
Cohesion: 0.07
Nodes (49): benchmark_pair(), count_tokens(), main(), print_table(), Path, main(), print_usage(), backup_dir_for() (+41 more)

### Community 31 - "caveman/skills/caveman-compress/scripts/validate.py"
Cohesion: 0.07
Nodes (49): benchmark_pair(), count_tokens(), main(), print_table(), Path, main(), print_usage(), backup_dir_for() (+41 more)

### Community 32 - ".agents/skills/caveman-compress/scripts/validate.py"
Cohesion: 0.05
Nodes (53): benchmark_pair(), count_tokens(), main(), print_table(), Path, main(), print_usage(), backup_dir_for() (+45 more)

### Community 33 - "caveman/agents/cavecrew-investigator.md"
Cohesion: 0.06
Nodes (28): Auto-clarity, Output (receipt), Refusals (terminal lines), Scope, Workflow, Auto-clarity, Example, Job (+20 more)

### Community 34 - ".agents/skills/caveman-compress/scripts/compress.py"
Cohesion: 0.19
Nodes (10): buildApp(), WahaLocationPayload, WahaMessagePayload, WahaWebhookEvent, healthRoutes(), webhookRoutes(), ContextData, contextStorage (+2 more)

### Community 36 - "caveman/package.json"
Cohesion: 0.07
Nodes (27): author, bin, caveman, bugs, url, description, engines, node (+19 more)

### Community 37 - "caveman-stats.js"
Cohesion: 0.15
Nodes (25): readHistory(), aggregateHistory(), attributeByMode(), COMPRESSION, deriveSavings(), findCompressedPairs(), findRecentSession(), formatHistory() (+17 more)

### Community 38 - "caveman-shrink/package.json"
Cohesion: 0.08
Nodes (25): author, bin, caveman-shrink, description, files, homepage, README.md, keywords (+17 more)

### Community 39 - "CLAUDE.md — caveman"
Cohesion: 0.11
Nodes (17): Agent distribution, Auto-clarity rule, Auto-generated / auto-synced — do not edit directly, Benchmarks, caveman-commit / caveman-review, caveman-compress, CI sync workflow, CLAUDE.md — caveman (+9 more)

### Community 40 - "settings.js"
Cohesion: 0.13
Nodes (19): addCommandHook(), claudeConfigDir(), crypto, fs, hasCavemanHook(), MANAGED_HOOK_BASENAMES, os, path (+11 more)

### Community 41 - ".agents/skills/caveman-compress/README.md"
Cohesion: 0.09
Nodes (20): Before / After, Benchmarks, How It Work, <img src="../../docs/assets/dancing-rock.svg" width="20" height="20" alt="rock"/> Caveman (285 tokens), Install, 📄 Original (706 tokens), Part of Caveman, Security (+12 more)

### Community 42 - "caveman/.agents/skills/caveman-compress/README.md"
Cohesion: 0.09
Nodes (20): Before / After, Benchmarks, How It Work, <img src="../../docs/assets/dancing-rock.svg" width="20" height="20" alt="rock"/> Caveman (285 tokens), Install, 📄 Original (706 tokens), Part of Caveman, Security (+12 more)

### Community 43 - "caveman/skills/caveman-compress/README.md"
Cohesion: 0.09
Nodes (20): Before / After, Benchmarks, How It Work, <img src="../../docs/assets/dancing-rock.svg" width="20" height="20" alt="rock"/> Caveman (285 tokens), Install, 📄 Original (706 tokens), Part of Caveman, Security (+12 more)

### Community 44 - "index.js"
Cohesion: 0.13
Nodes (17): compress(), compressDescriptionsInPlace(), compressProse(), FILLERS, HEDGES, LEADERS, PLEASANTRIES, PROTECTED_PATTERNS (+9 more)

### Community 45 - "click-catcher/package.json"
Cohesion: 0.10
Nodes (20): dependencies, dotenv, fastify, description, devDependencies, ts-node, @types/node, typescript (+12 more)

### Community 46 - "CustomerService"
Cohesion: 0.25
Nodes (7): 1. RTK (Rust Token Killer), 2. Caveman Mode, 3. Graphify (Codebase Graph Navigation), Install to All Platforms, Priority Order, Session Checklist, Tooling Mandate — graphify + rtk + caveman

### Community 47 - "caveman-config.js"
Cohesion: 0.15
Nodes (16): appendFlag(), findRepoConfigPath(), fs, getConfigDir(), getConfigPath(), getDefaultMode(), os, path (+8 more)

### Community 48 - "caveman-mode-tracker.js"
Cohesion: 0.12
Nodes (16): readFlag(), safeWriteFlag(), VALID_MODES, { execFileSync }, flagPath, fs, { getDefaultMode, safeWriteFlag, readFlag, recordModeChange, VALID_MODES }, INDEPENDENT_MODES (+8 more)

### Community 49 - "verify_repo.py"
Cohesion: 0.32
Nodes (18): CheckFailure, ensure(), _frontmatter_description(), load_compress_modules(), main(), Path, read_json(), run() (+10 more)

### Community 50 - "test_cavecrew_model_overrides.js"
Cohesion: 0.14
Nodes (14): AGENT_ENV_MAP, applyOverrides(), fs, patchFrontmatterModel(), path, resolvePluginRoot(), assert, BUILDER_FM (+6 more)

### Community 51 - "openclaw.js"
Cohesion: 0.23
Nodes (15): appendBootstrapToSoul(), frontmatterHasKey(), fs, installOpenclaw(), loadBootstrapSnippet(), loadSkillBody(), mergeOpenclawFrontmatter(), os (+7 more)

### Community 52 - "CLAUDE.md — Taskflow Project"
Cohesion: 0.12
Nodes (15): Architecture, Backend, CLAUDE.md — Taskflow Project, Code Style, Common Commands, Database, Environment Variables, Frontend (+7 more)

### Community 53 - "CLAUDE.md — Taskflow Project"
Cohesion: 0.12
Nodes (15): Architecture, Backend, CLAUDE.md — Taskflow Project, Code Style, Common Commands, Database, Environment Variables, Frontend (+7 more)

### Community 54 - "RTK Commands by Workflow"
Cohesion: 0.13
Nodes (14): Analysis & Debug (70-90% savings), Build & Compile (80-90% savings), Files & Search (60-75% savings), Git (59-80% savings), GitHub (26-87% savings), Golden Rule, Infrastructure (85% savings), JavaScript/TypeScript Tooling (70-90% savings) (+6 more)

### Community 55 - ".agents/skills/cavecrew/SKILL.md"
Cohesion: 0.14
Nodes (12): cavecrew, Example chaining, How to invoke, Model overrides, See also, What it does, Auto-clarity (inherited), Chaining patterns (+4 more)

### Community 56 - "Caveman Help"
Cohesion: 0.14
Nodes (12): caveman-help, Example output, How to invoke, See also, What it does, Caveman Help, Configure Default Mode, Deactivate (+4 more)

### Community 57 - "caveman/.agents/skills/cavecrew/SKILL.md"
Cohesion: 0.14
Nodes (12): cavecrew, Example chaining, How to invoke, Model overrides, See also, What it does, Auto-clarity (inherited), Chaining patterns (+4 more)

### Community 58 - "Caveman Help"
Cohesion: 0.14
Nodes (12): caveman-help, Example output, How to invoke, See also, What it does, Caveman Help, Configure Default Mode, Deactivate (+4 more)

### Community 59 - "Caveman Help"
Cohesion: 0.14
Nodes (12): caveman-help, Example output, How to invoke, See also, What it does, Caveman Help, Configure Default Mode, Deactivate (+4 more)

### Community 60 - "compilerOptions"
Cohesion: 0.14
Nodes (13): compilerOptions, esModuleInterop, forceConsistentCasingInFileNames, lib, module, outDir, rootDir, skipLibCheck (+5 more)

### Community 61 - "run.py"
Cohesion: 0.29
Nodes (12): call_api(), compute_stats(), dry_run(), format_prompt_label(), format_table(), load_caveman_system(), load_prompts(), main() (+4 more)

### Community 62 - "caveman/README.md"
Cohesion: 0.15
Nodes (12): Before / After, Benchmarks, Caveman 2, How it works, <img src="docs/assets/dancing-rock.svg" width="20" height="20" alt=""> Want the whole agent, not just its mouth? → caveman-code, Install, Pick your grunt, Privacy (+4 more)

### Community 63 - "e2e.freshinstall.test.mjs"
Cohesion: 0.15
Nodes (6): HERE, INSTALLER, REPO_ROOT, requireCjs, SETTINGS, SKILL_BODY_SRC

### Community 64 - "TypingService"
Cohesion: 0.33
Nodes (6): Hook installation, Hook system (Claude Code), `src/hooks/caveman-activate.js` — SessionStart hook, `src/hooks/caveman-config.js` — shared module, `src/hooks/caveman-mode-tracker.js` — UserPromptSubmit hook, `src/hooks/caveman-statusline.sh` — Statusline badge

### Community 65 - "Caveman Compress"
Cohesion: 0.17
Nodes (11): Boundaries, Caveman Compress, Compress, Compression Rules, Pattern, Preserve EXACTLY (never modify), Preserve Structure, Process (+3 more)

### Community 66 - ".agents/skills/caveman/SKILL.md"
Cohesion: 0.17
Nodes (10): caveman, Example output, How to invoke, See also, What it does, Auto-Clarity, Boundaries, Intensity (+2 more)

### Community 67 - "Caveman Compress"
Cohesion: 0.17
Nodes (11): Boundaries, Caveman Compress, Compress, Compression Rules, Pattern, Preserve EXACTLY (never modify), Preserve Structure, Process (+3 more)

### Community 68 - "caveman/.agents/skills/caveman/SKILL.md"
Cohesion: 0.17
Nodes (10): caveman, Example output, How to invoke, See also, What it does, Auto-Clarity, Boundaries, Intensity (+2 more)

### Community 69 - "Contributing to caveman"
Cohesion: 0.17
Nodes (11): Adding a new agent, Adding a new skill, Code style, Contributing to caveman, Ideas, Pull-request guidelines, Quick orientation, Running benchmarks and evals (+3 more)

### Community 70 - "Privacy & Telemetry"
Cohesion: 0.17
Nodes (9): About scanner warnings, After install: zero network calls, At install time: exactly these network requests, nothing else, Enterprise / air-gapped use, Privacy & Telemetry, Reporting a Vulnerability, Security Policy, Supported Versions (+1 more)

### Community 71 - "Caveman Compress"
Cohesion: 0.17
Nodes (11): Boundaries, Caveman Compress, Compress, Compression Rules, Pattern, Preserve EXACTLY (never modify), Preserve Structure, Process (+3 more)

### Community 72 - "Caveman Compress"
Cohesion: 0.17
Nodes (11): Boundaries, Caveman Compress, Compress, Compression Rules, Pattern, Preserve EXACTLY (never modify), Preserve Structure, Process (+3 more)

### Community 73 - "plugin.js"
Cohesion: 0.23
Nodes (9): applyModeChange(), CavemanPlugin(), config, flagPath, handleSessionCreated(), here, INDEPENDENT_MODES, parseModeChange() (+1 more)

### Community 74 - "caveman-commit"
Cohesion: 0.18
Nodes (9): caveman-commit, Example output, How to invoke, See also, What it does, Auto-Clarity, Boundaries, Examples (+1 more)

### Community 75 - "caveman-review"
Cohesion: 0.18
Nodes (9): caveman-review, Example output, How to invoke, See also, What it does, Auto-Clarity, Boundaries, Examples (+1 more)

### Community 76 - "caveman-commit"
Cohesion: 0.18
Nodes (9): caveman-commit, Example output, How to invoke, See also, What it does, Auto-Clarity, Boundaries, Examples (+1 more)

### Community 77 - "caveman-review"
Cohesion: 0.18
Nodes (9): caveman-review, Example output, How to invoke, See also, What it does, Auto-Clarity, Boundaries, Examples (+1 more)

### Community 78 - "caveman-commit"
Cohesion: 0.18
Nodes (9): caveman-commit, Example output, How to invoke, See also, What it does, Auto-Clarity, Boundaries, Examples (+1 more)

### Community 79 - "caveman-review"
Cohesion: 0.18
Nodes (9): caveman-review, Example output, How to invoke, See also, What it does, Auto-Clarity, Boundaries, Examples (+1 more)

### Community 80 - "caveman-init.js"
Cohesion: 0.29
Nodes (10): AGENTS, fs, help(), loadOpenclawHelper(), loadRuleBody(), main(), parseArgs(), path (+2 more)

### Community 81 - "test_caveman_stats.js"
Cohesion: 0.18
Nodes (8): assert, { execFileSync }, fs, os, path, ROOT, STATS, TRACKER

### Community 83 - "devDependencies"
Cohesion: 0.18
Nodes (11): devDependencies, prisma, tsx, @types/node, typescript, vitest, @types/node, typescript (+3 more)

### Community 84 - "Click Catcher Microservice"
Cohesion: 0.18
Nodes (10): 🚀 Cara Menjalankan, 🔮 Catatan Pengembangan Masa Depan, Click Catcher Microservice, 🛠️ Environment Variables (.env), 🔗 Integrasi dengan Checkout Page (Scalev, Dll), 🛡️ Prinsip Desain: Fail-Open & Kecepatan Tinggi, Skenario 1: Custom Link/Redirect di Tombol Checkout/ATC, Skenario 2: Custom JavaScript Injection (Jika Tombol WhatsApp Tidak Bisa Diubah) (+2 more)

### Community 85 - "caveman-activate.js"
Cohesion: 0.20
Nodes (9): flagPath, fs, { getDefaultMode, safeWriteFlag, recordModeChange }, INDEPENDENT_MODES, mode, os, path, settingsPath (+1 more)

### Community 86 - "opencode.test.mjs"
Cohesion: 0.20
Nodes (5): HERE, INSTALLER, REPO_ROOT, requireCjs, SETTINGS

### Community 87 - "test_caveman_init.js"
Cohesion: 0.20
Nodes (7): assert, { execFileSync }, fs, INIT, os, path, ROOT

### Community 88 - "CompressSafetyTests"
Cohesion: 0.42
Nodes (3): CompressSafetyTests, Path, Tests for the data-loss guards in `compress_file` (issue #237).  The compress

### Community 90 - "Evals"
Cohesion: 0.07
Nodes (26): Honest Numbers, Measure it yourself, Rule of thumb, The measured numbers, What caveman actually does, When caveman loses (net-negative), When caveman wins, Adding a prompt (+18 more)

### Community 91 - "Install caveman"
Cohesion: 0.22
Nodes (9): Always-on rules, Manual install (no `curl | bash`), Install caveman, One-liner, Per-agent install, Privacy, Troubleshooting, Uninstall (+1 more)

### Community 92 - "Caveman Hooks"
Cohesion: 0.22
Nodes (8): `caveman-activate.js` — SessionStart hook, Caveman Hooks, `caveman-mode-tracker.js` — UserPromptSubmit hook, `caveman-statusline.sh` / `caveman-statusline.ps1` — Statusline badge script, How It Works, Statusline Badge, Uninstall, What's Included

### Community 93 - "test_mode_tracker_stdin.js"
Cohesion: 0.22
Nodes (6): assert, fs, HOOK_PATH, os, path, { spawnSync }

### Community 94 - "marketplace.json"
Cohesion: 0.25
Nodes (7): description, name, owner, name, url, plugins, $schema

### Community 96 - "caveman-shrink"
Cohesion: 0.25
Nodes (7): caveman-shrink, Configuration, Install, License, Status, Use it, What it does NOT touch

### Community 97 - "API Integration Guide"
Cohesion: 0.25
Nodes (7): API Integration Guide, Authentication, Creating Tasks, Error Handling, Pagination, Rate Limiting, Webhooks

### Community 98 - "API Integration Guide"
Cohesion: 0.25
Nodes (7): API Integration Guide, Authentication, Creating Tasks, Error Handling, Pagination, Rate Limiting, Webhooks

### Community 99 - "hermes.test.mjs"
Cohesion: 0.25
Nodes (4): HERE, INSTALLER, REPO_ROOT, SKILLS

### Community 100 - "test_mcp_shrink.js"
Cohesion: 0.25
Nodes (6): assert, { compress, compressDescriptionsInPlace }, fs, { getSpawnOptions }, path, ROOT

### Community 101 - "caveman-stats"
Cohesion: 0.29
Nodes (5): caveman-stats, Example output, How to invoke, See also, What it does

### Community 102 - "caveman-stats"
Cohesion: 0.29
Nodes (5): caveman-stats, Example output, How to invoke, See also, What it does

### Community 103 - "Contributor Covenant Code of Conduct"
Cohesion: 0.29
Nodes (6): Contributor Covenant Code of Conduct, Enforcement Responsibilities, Our Pledge, Our Standards, Reporting & Contact, Scope

### Community 104 - "Honest Numbers"
Cohesion: 0.33
Nodes (3): cheerio, sanitize_html_1, TenantHtmlService

### Community 105 - "plugins/caveman/agents/cavecrew-investigator.md"
Cohesion: 0.29
Nodes (6): Auto-clarity, Example, Job, Output, Refusals, Tools

### Community 106 - "plugins/caveman/skills/cavecrew/SKILL.md"
Cohesion: 0.29
Nodes (6): Auto-clarity (inherited), Chaining patterns, Output contracts, What NOT to do, When to use cavecrew vs alternatives, Why this exists (the real win)

### Community 107 - "caveman-stats"
Cohesion: 0.29
Nodes (5): caveman-stats, Example output, How to invoke, See also, What it does

### Community 108 - "opencode/package.json"
Cohesion: 0.29
Nodes (6): description, main, name, private, type, version

### Community 109 - "User Preferences"
Cohesion: 0.29
Nodes (6): Code Style, Communication Style, Testing Approach, Things to Avoid, User Preferences, Workflow Preferences

### Community 110 - "User Preferences"
Cohesion: 0.29
Nodes (6): Code Style, Communication Style, Testing Approach, Things to Avoid, User Preferences, Workflow Preferences

### Community 111 - "Project Notes — Taskflow"
Cohesion: 0.29
Nodes (6): Architecture Decision: Background Job Processing (March 2026), Design Decision: Component Library (January 2026), Meeting Notes: Security Review (February 2026), Performance Investigation: Dashboard Slowness (March 2026), Project Notes — Taskflow, Technical Debt Inventory (January 2026)

### Community 112 - "Project Notes — Taskflow"
Cohesion: 0.29
Nodes (6): Architecture Decision: Background Job Processing (March 2026), Design Decision: Component Library (January 2026), Meeting Notes: Security Review (February 2026), Performance Investigation: Dashboard Slowness (March 2026), Project Notes — Taskflow, Technical Debt Inventory (January 2026)

### Community 113 - "opencode-agent.test.mjs"
Cohesion: 0.29
Nodes (5): HERE, REPO_ROOT, requireCjs, SHIPPED_AGENT_FILES, { stripOpencodeAgentTools }

### Community 115 - "measure.py"
Cohesion: 0.53
Nodes (5): count(), fmt_pct(), main(), Read evals/snapshots/results.json (produced by llm_run.py) and report real toke, stats()

### Community 116 - "plugins/caveman/agents/cavecrew-builder.md"
Cohesion: 0.33
Nodes (5): Auto-clarity, Output (receipt), Refusals (terminal lines), Scope, Workflow

### Community 117 - "plugins/caveman/agents/cavecrew-reviewer.md"
Cohesion: 0.33
Nodes (5): Auto-clarity, Boundaries, Output, Severity, Tools

### Community 118 - "plugins/caveman/skills/caveman/SKILL.md"
Cohesion: 0.33
Nodes (5): Auto-Clarity, Boundaries, Intensity, Persistence, Rules

### Community 120 - "caveman — opencode plugin"
Cohesion: 0.33
Nodes (5): caveman — opencode plugin, What it does, What it does NOT do, What this ships, Why no separate npm package

### Community 121 - "Sprint 24 — Task List"
Cohesion: 0.33
Nodes (5): Completed This Sprint, High Priority, Low Priority, Medium Priority, Sprint 24 — Task List

### Community 122 - "Sprint 24 — Task List"
Cohesion: 0.33
Nodes (5): Completed This Sprint, High Priority, Low Priority, Medium Priority, Sprint 24 — Task List

### Community 123 - "slash-commands.test.mjs"
Cohesion: 0.33
Nodes (5): COMMANDS_DIR, DOCUMENTED_COMMANDS, HERE, REPO_ROOT, STATS_TOML

### Community 124 - "RTK - Rust Token Killer (Google Antigravity)"
Cohesion: 0.40
Nodes (4): Meta Commands, RTK - Rust Token Killer (Google Antigravity), Rule, Why

### Community 125 - "Windows install fallback"
Cohesion: 0.40
Nodes (4): Codex on Windows, `npx skills` symlink fallback, Want it always on (any agent)?, Windows install fallback

### Community 126 - "llm_run.py"
Cohesion: 0.60
Nodes (4): claude_version(), main(), Run each prompt through Claude Code in three conditions and snapshot the real L, run_claude()

### Community 127 - "ps1-pipe.test.mjs"
Cohesion: 0.40
Nodes (4): code, HERE, PS1, REPO_ROOT

### Community 128 - "package.json"
Cohesion: 0.40
Nodes (4): description, main, name, version

### Community 129 - "@prisma/client"
Cohesion: 0.40
Nodes (4): @prisma/client, @prisma/client, main(), prisma

### Community 130 - "plot.py"
Cohesion: 0.67
Nodes (3): count(), main(), Generate a boxplot showing the distribution of token compression per skill, com

### Community 133 - "server.ts"
Cohesion: 0.16
Nodes (9): ServerTrackingConfig, TenantHtmlService, CacheEntry, fastify, fetchTenantContent(), PORT, renderLandingHandler(), RESERVED_SLUGS (+1 more)

## Knowledge Gaps
- **851 isolated node(s):** `$schema`, `name`, `description`, `name`, `url` (+846 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **25 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `call_claude()` connect `caveman/.agents/skills/caveman-compress/scripts/validate.py` to `.agents/skills/caveman-compress/scripts/validate.py`?**
  _High betweenness centrality (0.006) - this node is a cross-community bridge._
- **Why does `call_claude()` connect `plugins/caveman/skills/caveman-compress/scripts/validate.py` to `.agents/skills/caveman-compress/scripts/validate.py`?**
  _High betweenness centrality (0.006) - this node is a cross-community bridge._
- **What connects `$schema`, `name`, `description` to the rest of the system?**
  _851 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `TypingService` be split into smaller, more focused modules?**
  _Cohesion score 0.07396870554765292 - nodes in this community are weakly interconnected._
- **Should `🔄 2. Histori Perjalanan Revisi (Chronological Revisions History)` be split into smaller, more focused modules?**
  _Cohesion score 0.09523809523809523 - nodes in this community are weakly interconnected._
- **Should `webhook.route.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.125 - nodes in this community are weakly interconnected._
- **Should `knowledge.service.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.08084163898117387 - nodes in this community are weakly interconnected._