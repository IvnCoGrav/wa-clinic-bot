/**
 * scan-secrets.ts — Skrip Audit Keamanan Pre-Commit / Pre-Push
 *
 * Mendeteksi potensi kebocoran API Key (Kenari, SumoPod, OpenAI, DeepSeek, Google, Meta, dll.)
 * dan memblokir git commit / push jika ditemukan kredensial riil.
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

interface SecretRule {
  name: string;
  pattern: RegExp;
  allowlist?: RegExp[];
}

const SECRET_RULES: SecretRule[] = [
  {
    name: 'Kenari API Key (awalan kn-)',
    pattern: /\bkn-[A-Za-z0-9_-]{16,}\b/,
    allowlist: [
      /kn-your-api-key-here/i,
      /kn-test/i,
      /kn-dummy/i,
    ],
  },
  {
    name: 'OpenAI / SumoPod / DeepSeek API Key (awalan sk-)',
    pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/,
    allowlist: [
      /sk-your-sumopod-key-here/i,
      /your_llm_api_key_here/i,
      /sk-test/i,
      /sk-main/i,
      /sk-external-test/i,
      /sk-dummy/i,
      /sk-sample/i,
      /sk-xPRgkZmQakNaOq44qqzPLw/i, // Old revoked key in audit docs
      /sk-znFVknm5AgYRh8G4PzH7wQ/i, // Old revoked key in audit docs
      /sk-8ff19ada8ced4e29/i,       // Old revoked key in audit docs
    ],
  },
  {
    name: 'Google Maps / Cloud API Key',
    pattern: /\bAIza[0-9A-Za-z-_]{35}\b/,
    allowlist: [
      /AIzaSyValidTestKey/i,
      /AIzaSyInvalidKey/i,
      /AIzaSy\.\.\./i,
    ],
  },
  {
    name: 'Meta CAPI / Graph API Access Token',
    pattern: /\bEAAR[0-9A-Za-z]{30,}\b/,
    allowlist: [
      /EAAR_YOUR_ACCESS_TOKEN_HERE/i,
      /EAAR_TEST/i,
    ],
  },
  {
    name: 'OpenRouteService API Key (JWT format)',
    pattern: /ORS_API_KEY\s*=\s*["']eyJ[A-Za-z0-9_-]{30,}["']/,
    allowlist: [],
  },
  {
    name: 'Private Key PEM',
    pattern: /-----BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY-----/,
    allowlist: [],
  },
];

const IGNORED_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.svg',
  '.woff', '.woff2', '.ttf', '.eot',
  '.lock', '.bin', '.gz', '.zip',
]);

function maskSecret(val: string): string {
  if (val.length <= 8) return '****';
  return val.slice(0, 4) + '****' + val.slice(-4);
}

export function scanFile(filePath: string): { ruleName: string; line: number; snippet: string }[] {
  const ext = path.extname(filePath).toLowerCase();
  if (IGNORED_EXTENSIONS.has(ext)) return [];

  // Tolak file .env aktif (kecuali .env.example)
  const baseName = path.basename(filePath);
  if (baseName === '.env' || (baseName.startsWith('.env.') && baseName !== '.env.example')) {
    return [{
      ruleName: 'File Kredensial Lingkungan (.env)',
      line: 1,
      snippet: 'File .env tidak boleh di-commit ke Git!',
    }];
  }

  if (!fs.existsSync(filePath)) return [];

  let content = '';
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return []; // Binary file
  }

  const findings: { ruleName: string; line: number; snippet: string }[] = [];
  const lines = content.split('\n');

  lines.forEach((line, idx) => {
    for (const rule of SECRET_RULES) {
      const match = line.match(rule.pattern);
      if (match) {
        const matchedText = match[0];
        const isAllowed = rule.allowlist?.some((allow) => allow.test(matchedText) || allow.test(line));
        if (!isAllowed) {
          findings.push({
            ruleName: rule.name,
            line: idx + 1,
            snippet: line.replace(matchedText, maskSecret(matchedText)).trim(),
          });
        }
      }
    }
  });

  return findings;
}

function run(): void {
  const args = process.argv.slice(2);
  const isStagedOnly = args.includes('--staged');

  console.log(`🔍 [SECRET SCANNER] Memeriksa potensi kebocoran API key (${isStagedOnly ? 'staged files' : 'working tree'})...`);

  let filesToScan: string[] = [];

  try {
    if (isStagedOnly) {
      const output = execSync('git diff --cached --name-only --diff-filter=ACM', { encoding: 'utf-8' });
      filesToScan = output.split('\n').map((f) => f.trim()).filter(Boolean);
    } else {
      const output = execSync('git status --porcelain', { encoding: 'utf-8' });
      filesToScan = output
        .split('\n')
        .map((line) => line.slice(3).trim())
        .filter((f) => Boolean(f) && !f.startsWith('scratch/') && !f.startsWith('.gemini/'));
    }
  } catch (err: any) {
    console.error('❌ Gagal mengambil daftar file Git:', err.message);
    process.exit(1);
  }

  if (filesToScan.length === 0) {
    console.log('✅ Tidak ada file yang perlu diperiksa.');
    process.exit(0);
  }

  let totalFindings = 0;

  for (const file of filesToScan) {
    const findings = scanFile(file);
    if (findings.length > 0) {
      totalFindings += findings.length;
      console.error(`\n🚨 POTENSI KEBOCORAN KREDENSIAL DI: ${file}`);
      for (const item of findings) {
        console.error(`   Baris ${item.line} [${item.ruleName}]: ${item.snippet}`);
      }
    }
  }

  if (totalFindings > 0) {
    console.error(`\n❌ DITEMUKAN ${totalFindings} POTENSI KEBOCORAN KREDENSIAL!`);
    console.error('👉 Mitigasi: Ganti nilai dengan placeholder atau pastikan file sensitif terdaftar di .gitignore.');
    process.exit(1);
  }

  console.log(`✅ [SECRET SCANNER LULUS] ${filesToScan.length} file telah dipindai, tidak ada kebocoran API key!`);
  process.exit(0);
}

if (require.main === module) {
  run();
}
