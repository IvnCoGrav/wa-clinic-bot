import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const PHASE_FILES = {
  'fase-01': [
    'tests/unit/tenant-failclosed.test.ts',
    'tests/unit/tenant-resolve-failclosed.test.ts',
    'tests/unit/lifecycle-shutdown.test.ts',
    'tests/unit/lifecycle-interval-registry.test.ts',
    'tests/unit/auth-access-log.test.ts',
    'tests/unit/log-buffer.test.ts',
    'tests/unit/queue.test.ts',
  ],
  'fase-02': [
    'tests/unit/typing.test.ts',
    'tests/unit/typing-sync.test.ts',
    'tests/unit/typing-transport.test.ts',
    'tests/unit/burst-coalesce.test.ts',
    'tests/unit/turn-recovery.test.ts',
    'tests/unit/turn-repository-claim.test.ts',
    'tests/unit/webhook-security.test.ts',
    'tests/unit/webhook-stale-message-guard.test.ts',
    'tests/unit/waba-driver-and-webhook.test.ts',
    'tests/unit/waba-template-consent-optout.test.ts',
    'tests/unit/waha-retry.test.ts',
  ],
  'fase-03': [
    'tests/unit/v3/guardrail-pipeline.test.ts',
    'tests/unit/tool-masker.test.ts',
    'tests/unit/tool-schemas.test.ts',
    'tests/v3/agent-tools.test.ts',
    'tests/unit/get-catalog-tool-grounding.test.ts',
    'tests/unit/v3-safety-sanitizer.test.ts',
    'tests/unit/v3-persona-rules.test.ts',
    'tests/unit/v3/numeric-guardrail-no-tool-bypass.test.ts',
    'tests/unit/v3/tool-masking-enforce.test.ts',
    'tests/integration/deterministic-guardrails-session-391501.test.ts',
  ],
  'fase-04': [
    'tests/integration/reservation-archive.test.ts',
    'tests/unit/slot-overlap-sweep.test.ts',
    'tests/unit/destructive-guard.test.ts',
    'tests/unit/cron_auto_purge.test.ts',
    'tests/integration/active-reservations-endpoint.test.ts',
    'tests/unit/reservation-lifecycle-homonym-gate.test.ts',
    'tests/unit/customer-payment-proof.test.ts',
  ],
  'fase-05': [
    'tests/unit/staff-auth-and-reservation.test.ts',
    'tests/integration/staff-routes.test.ts',
    'tests/unit/staff-session-store.test.ts',
    'tests/unit/staff-trip-tracking.test.ts',
    'tests/unit/staff-trip-auto-close.test.ts',
    'tests/unit/staff-send-payment-info.test.ts',
    'tests/unit/staff-telegram-notification.test.ts',
    'tests/unit/staff-chat-pii-masker.test.ts',
  ],
  'fase-06': [
    'tests/integration/live-chat-sse.test.ts',
    'tests/integration/live-chat-takeover.test.ts',
    'tests/unit/live-chat.service.test.ts',
    'tests/unit/live-chat-pin-hide.test.ts',
    'tests/unit/livechat-message-loss-prevention.test.ts',
    'tests/unit/media-security.test.ts',
    'tests/unit/live-chat-sync-health.test.ts',
  ],
  'fase-07': [
    'tests/unit/waha-ctwa-referral.test.ts',
    'tests/integration/admin-ctwa-catchers.test.ts',
    'tests/unit/capi-payload-sanitizer.test.ts',
    'tests/integration/capi-queue-integrity.test.ts',
    'tests/unit/capi-tenant-isolation.test.ts',
    'tests/unit/capi-value-no-hardcode.test.ts',
    'tests/integration/ad-click.test.ts',
    'tests/integration/pricelist-dynamic.test.ts',
    'tests/integration/customer-audience-export.test.ts',
  ],
  'fase-08': [
    'tests/unit/cron_auto_purge.test.ts',
    'tests/unit/lifecycle-interval-registry.test.ts',
    'tests/unit/anti-silent-drop-invariant.test.ts',
    'tests/unit/staff-trip-auto-close.test.ts',
    'tests/unit/backup.test.ts',
    'tests/unit/sheets-sync.service.test.ts',
  ],
  'fase-09': [
    'tests/unit/sheets-sync.service.test.ts',
    'tests/unit/sheets-rekapan-formatter.test.ts',
    'tests/unit/google-contacts.test.ts',
    'tests/unit/google-distance.test.ts',
    'tests/unit/google-geocode-tier.test.ts',
    'tests/unit/telegram-service.test.ts',
    'tests/unit/telegram-webhook-failclosed.test.ts',
    'tests/unit/web-push.service.test.ts',
    'tests/unit/model-fallback-chain.test.ts',
  ],
  'fase-10': [
    'tests/unit/admin-rbac-guard.test.ts',
    'tests/unit/ai-model-settings.test.ts',
    'tests/unit/ai-scope-gate.test.ts',
    'tests/unit/admin-persona-prompt-config.test.ts',
    'tests/unit/admin-payment-info-settings.test.ts',
    'tests/unit/backup.test.ts',
    'tests/unit/tenant-settings-resilience.test.ts',
  ],
  'fase-11': [
    'tests/unit/webhook-security.test.ts',
    'tests/unit/media-security.test.ts',
    'tests/unit/media-query-auth-ban.test.ts',
    'tests/integration/push-rbac.test.ts',
    'tests/integration/raw_html_security.test.ts',
    'tests/unit/auth-access-log.test.ts',
  ],
};

const isListOnly = process.argv.includes('--list');
// Skrip ini mengeksekusi ratusan test. Jangan pernah jalan hanya karena
// diimpor (mis. `await import('./scripts/audit-phase-gates.mjs')` untuk
// membaca PHASE_FILES) — itu pernah memicu eksekusi tak sengaja.
const isDirectRun =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;

function main() {
  let totalMissing = 0;
  let totalPhases = 0;

  for (const [phase, files] of Object.entries(PHASE_FILES)) {
    totalPhases++;
    const missing = files.filter((f) => !fs.existsSync(f));
    if (missing.length > 0) {
      console.error(`[${phase}] MISSING ${missing.length} files:`, missing);
      totalMissing += missing.length;
      process.exitCode = 1;
    } else if (isListOnly) {
      console.log(`[${phase}] PASS (0 missing) -> ${files.length} test files`);
    }
  }

  if (isListOnly) {
    console.log(`\n=== SUMMARY: ${totalPhases} phases checked, ${totalMissing} missing files ===`);
    process.exit(totalMissing === 0 ? 0 : 1);
  }

  if (totalMissing > 0) {
    console.error(`\nAborting execution: ${totalMissing} files missing.`);
    process.exit(1);
  }

  // Execute gates
  let failedPhases = 0;

  for (const [phase, files] of Object.entries(PHASE_FILES)) {
    console.log(`\n>>> Running gate for ${phase} (${files.length} files)...`);
    const outputFile = `docs/audit/2026-11-02/${phase}-recheck.json`;
    let execError = null;
    try {
      execFileSync(
        'npx',
        ['vitest', 'run', ...files, '--reporter=json', `--outputFile=${outputFile}`],
        { stdio: 'inherit', shell: true }
      );
    } catch (err) {
      execError = err;
    }

    // Gate ini WAJIB bisa gagal. Jangan menelan kegagalan vitest: baca artefak
    // JSON dan pastikan benar-benar 0 test gagal. (Regresi #299: gate lama selalu
    // exit 0 karena hanya console.warn.)
    let failedTests = null;
    if (fs.existsSync(outputFile)) {
      try {
        const report = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
        failedTests = report.numFailedTests;
      } catch {
        failedTests = null;
      }
    }

    if (execError || failedTests === null || failedTests > 0) {
      failedPhases++;
      process.exitCode = 1;
      console.error(
        `[${phase}] GATE GAGAL -> failedTests=${failedTests ?? 'unknown'}` +
          (execError ? ` (exit tidak nol: ${execError.status})` : '')
      );
      continue;
    }

    console.log(`[${phase}] GATE PASS (0 gagal) -> ${outputFile}`);
  }

  console.log(`\n=== SUMMARY: ${totalPhases} fase, ${failedPhases} fase GAGAL ===`);
  if (failedPhases > 0) process.exitCode = 1;
}

if (isDirectRun) {
  main();
}
