import { spawnSync } from 'node:child_process';

async function main() {
  const key = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || '';
  if (!key || key.startsWith('mock')) {
    console.error('[LLM SMOKE] GAGAL: LLM_API_KEY/OPENAI_API_KEY wajib diisi.');
    process.exit(1);
  }

  const { runNumericHarness } = await import('./numeric-hallucination-harness');
  const numeric = await runNumericHarness();
  const persona = spawnSync(
    process.execPath,
    ['--import', 'tsx', 'tests/evals/persona-quality-harness.ts', '--audit-only', '--limit=10', '--runs=1'],
    { stdio: 'inherit' }
  );

  if (numeric.failed > 0 || persona.status !== 0) process.exit(1);
}

void main();
