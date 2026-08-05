# AGENTS.md

WhatsApp clinic chatbot engine: Node 20 + TypeScript, Fastify, Prisma/PostgreSQL, WAHA (WhatsApp HTTP API). Most docs, comments, and CHANGELOG are in **Indonesian** — keep new ones consistent.

## Commands

- `npm run dev` — hot-reload dev server (`tsx watch src/app.ts`). No separate lint/typecheck script exists; `npm run build` (`tsc`) is the typecheck.
- `npm test` — full Vitest suite; `npx vitest run tests/unit/typing.test.ts` — one file.
- `npm run chat` — interactive CLI conversation simulator, no WhatsApp needed.
- `npx tsx src/scripts/check-router-accuracy.ts --days=7` — AI-router shadow-mode accuracy gate (see README for pass criteria).
- `npm run prisma:generate` / `npm run prisma:migrate` / `npx prisma db push` — schema sync.
- Local runs without a real WhatsApp: set `WAHA_MOCK=true` (wired in `src/integrations/waha/client.ts`).

## Tests

- **Run offline — no DB or network required.** `tests/setup.ts` mocks `src/db/client` (all Prisma calls reject with "Database offline") which triggers the in-memory fallback stores, and blanks `ORS_API_KEY` to force the Haversine fallback. Don't start Postgres or change the mocks for unit tests.
- Only `tests/**/*.test.ts` is discovered; services intentionally degrade silently (try/catch fallback) when DB is down — green tests can mask runtime DB failures.

## Prisma / migrations (known traps)

- **NEVER run `prisma generate --no-engine`** — it produces an Accelerate-only client that dies at runtime with `P6001` (URL must start `prisma://`). If the engine DLL is locked, kill the locker (dev server / prisma studio), then run full `prisma generate`.
- `npx prisma migrate diff --from-migrations` (shadow replay) is **broken** by `FollowUpStatus` enum ordering in `20260801000000_add_failed_followup_status`. Check drift instead:
  `npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script` → must output `-- This is an empty migration.`
- Fresh-env deploy error `relation "children" already exists`: run once `npx prisma migrate resolve --applied 20260802000000_add_children`, then `npx prisma migrate deploy`. Never drop the `children` table.
- Details: `docs/KNOWN_ISSUES.md`, README "Deployment & Runbook Migration".

## Architecture

- Entry `src/app.ts` (`buildApp()`). Boot **requires** `ADMIN_API_KEY`; production also requires `WAHA_WEBHOOK_SECRET`.
- Webhooks: `POST /webhook` (WAHA), `GET|POST /api/webhook/waba` (Meta Cloud). Admin API under `/api/admin/*`.
- WhatsApp traffic goes through the gateway abstraction in `src/integrations/whatsapp/` (WAHA + WABA drivers, per-tenant factory) — use `getGateway()`/`getWabaGateway()`, not `WahaClient` directly.
- Multi-tenant-ready: `DEFAULT_TENANT_ID='default-tenant'` (`src/config/tenant.ts`). Delivery tiers, treatment catalog, persona, and AI model config load from DB at boot.

## Repo conventions (mandatory)

- **SaaS-readiness**: any new feature/config/tuning must be tenant-aware — business data (brand names, message templates, system prompts) MUST come from DB, never hardcoded. Pengecualian (hardcode sementara / tunda tenant-aware) WAJIB lewat **Confirmation Gate** — stop & konfirmasi ke user dengan pros/cons — bila solusi tenant-aware butuh infrastruktur baru / LOC sangat besar / migrasi berisiko. See `.agents/skills/saas-readiness/SKILL.md` and `docs/SAAS_READINESS_AUDIT.md`.
- **Admin dashboard** (`packages/admin-dashboard`, React): never `window.confirm`/`alert` — use `useUiFeedback`. See `.agents/skills/no-native-confirm-alert/SKILL.md`.

## Monorepo (no npm workspaces)

- Root `package.json` = bot engine. Each `packages/*` has its own install/lockfile — run `npm install` inside them.
- `packages/admin-dashboard`: React + Vite + Tailwind. The bot serves its built `dist/` at `/admin/*` — **rebuild it** (`npm run build` in that dir) and restart the bot to see UI changes; or `npm run dev` (Vite) for standalone UI dev.
- `packages/click-catcher`: **RETIRED** — landing page kini di-serve langsung oleh bot (`src/routes/landing.route.ts` + `src/landing/public/go.html`). Paket ini dibiarkan di repo untuk referensi, tidak lagi dipakai di docker-compose.

## Tooling

- `rtk` is a 9router model-layer feature, **not a shell command** — `rtk git ...` fails with CommandNotFoundException. Run plain commands; token filtering happens automatically at the model layer.
- graphify knowledge graph in `graphify-out/` (gitignored): use `graphify query/explain/path` for codebase questions and run `graphify update .` after editing code.
- Agent instruction sources: `.agents/` (skills + rules).

## Deploy

- docker-compose pins `devlikeapro/waha:noweb-2026.7.2` (Postgres 16). Never use `:latest` for WAHA; validate WAHA upgrades in staging first. Notes: `deploy_config.txt`, README.
- `.env` holds live credentials and is gitignored — never commit it or its values.
