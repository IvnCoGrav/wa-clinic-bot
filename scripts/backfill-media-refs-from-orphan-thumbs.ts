#!/usr/bin/env tsx
/**
 * Backfill: pulihkan referensi media pada pesan yang `payload_raw`-nya rusak
 * (`{"unset":["media","hdUrl"]}`) akibat operasi JSON Prisma yang tidak sah.
 *
 * Strategi: file thumbnail yang masih ada di disk tapi tidak direferensikan
 * pesan mana pun ("yatim") dicocokkan ke pesan lewat waktu file ≈ created_at
 * (toleransi 5 detik). Hanya kecocokan TUNGGAL yang diterapkan; yang ambigu
 * dilewati agar tidak salah tempel gambar.
 *
 * Jalankan: npx tsx scripts/backfill-media-refs-from-orphan-thumbs.ts --dry-run
 * Apply:     npx tsx scripts/backfill-media-refs-from-orphan-thumbs.ts --apply
 */

import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();
const MEDIA_ROOT = path.join(process.cwd(), 'storage', 'media');
const TOLERANCE_MS = 5000;

interface AffectedRow {
  id: string;
  conversation_id: string;
  content: string | null;
  created_at: Date;
}

interface FileEntry {
  relUrl: string;
  fullPath: string;
  mtimeMs: number;
}

function listFiles(tenantId: string): FileEntry[] {
  const out: FileEntry[] = [];
  for (const scope of ['inbound', 'outbound'] as const) {
    const dir = path.join(MEDIA_ROOT, scope, tenantId);
    let names: string[] = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!/_thumb\.\w+$/i.test(name)) continue;
      const fullPath = path.join(dir, name);
      try {
        const st = fs.statSync(fullPath);
        if (!st.isFile()) continue;
        out.push({ relUrl: `/media/${scope}/${tenantId}/${name}`, fullPath, mtimeMs: st.mtimeMs });
      } catch {
        // file hilang saat dibaca
      }
    }
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--apply');
  const tenantId = args.find((a) => a.startsWith('--tenant='))?.split('=')[1] || 'default-tenant';
  const toleranceMs = Number(args.find((a) => a.startsWith('--tolerance='))?.split('=')[1] || TOLERANCE_MS);

  console.log(`[BACKFILL-MEDIA] Mode: ${dryRun ? 'DRY-RUN' : 'APPLY'} | tenant=${tenantId} | toleransi=${toleranceMs}ms`);

  const affected = await prisma.$queryRaw<AffectedRow[]>`
    SELECT id, conversation_id, left(coalesce(content,''), 120) AS content, created_at
    FROM messages
    WHERE tenant_id = ${tenantId} AND payload_raw->>'unset' IS NOT NULL
    ORDER BY created_at ASC
  `;
  console.log(`[BACKFILL-MEDIA] Pesan rusak: ${affected.length}`);

  const refs = new Set<string>();
  const msgRefs = await prisma.$queryRaw<Array<{ u: string | null }>>`
    SELECT payload_raw->'media'->>'url' AS u FROM messages WHERE tenant_id = ${tenantId}
    UNION SELECT payload_raw->'media'->>'hdUrl' FROM messages WHERE tenant_id = ${tenantId}
    UNION SELECT payload_raw->'media'->>'thumbUrl' FROM messages WHERE tenant_id = ${tenantId}
  `;
  msgRefs.forEach((r) => { if (r.u) refs.add(r.u); });
  const custRefs = await prisma.$queryRaw<Array<{ u: string | null }>>`
    SELECT preferences->>'house_photo_url' AS u FROM customers WHERE tenant_id = ${tenantId}
  `;
  custRefs.forEach((r) => { if (r.u) refs.add(r.u); });
  const tenantRow = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { pricelist_image_url: true } });
  if (tenantRow?.pricelist_image_url) refs.add(tenantRow.pricelist_image_url);

  const orphans = listFiles(tenantId).filter((f) => !refs.has(f.relUrl));
  console.log(`[BACKFILL-MEDIA] Thumbnail yatim tersedia: ${orphans.length}`);

  const used = new Set<string>();
  const matches: Array<{ msg: AffectedRow; file: FileEntry }> = [];
  let ambiguous = 0;
  let noMatch = 0;

  for (const msg of affected) {
    const t = new Date(msg.created_at).getTime();
    const candidates = orphans.filter(
      (f) => !used.has(f.relUrl) && Math.abs(f.mtimeMs - t) <= toleranceMs
    );
    if (candidates.length === 1) {
      matches.push({ msg, file: candidates[0] });
      used.add(candidates[0].relUrl);
    } else if (candidates.length > 1) {
      ambiguous++;
    } else {
      noMatch++;
    }
  }

  const csv: string[] = ['message_id,conversation_id,created_at,content,matched_thumb,status'];
  const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  for (const m of matches) {
    csv.push([
      m.msg.id,
      m.msg.conversation_id,
      new Date(m.msg.created_at).toISOString(),
      m.msg.content,
      m.file.relUrl,
      'READY',
    ].map(esc).join(','));
  }

  let applied = 0;
  if (!dryRun) {
    for (const m of matches) {
      await prisma.message.updateMany({
        where: { id: m.msg.id, tenant_id: tenantId },
        data: {
          payload_raw: {
            media: {
              url: m.file.relUrl,
              thumbUrl: m.file.relUrl,
              mimeType: 'image/jpeg',
              caption: null,
            },
          },
        },
      });
      applied++;
    }
  }

  try {
    fs.mkdirSync(path.join(process.cwd(), 'logs'), { recursive: true });
    const outFile = path.join(process.cwd(), 'logs', `backfill-media-${Date.now()}.csv`);
    fs.writeFileSync(outFile, csv.join('\n'), 'utf8');
    console.log(`[BACKFILL-MEDIA] CSV: ${outFile}`);
  } catch (e: any) {
    console.warn(`[BACKFILL-MEDIA] Gagal menulis CSV: ${e?.message || e}`);
  }

  console.log(
    `[BACKFILL-MEDIA] Cocok tunggal: ${matches.length} | ambigu: ${ambiguous} | tanpa file: ${noMatch} | ${dryRun ? 'siap' : 'diterapkan'}: ${dryRun ? matches.length : applied}`
  );

  if (matches.length > 0) {
    console.log('[BACKFILL-MEDIA] Sampel 5 pertama:');
    for (const m of matches.slice(0, 5)) {
      console.log(`  - ${m.msg.id} | ${new Date(m.msg.created_at).toISOString()} | ${m.file.relUrl} | ${(m.msg.content || '').replace(/\n/g, ' ').slice(0, 50)}`);
    }
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('[BACKFILL-MEDIA] FATAL:', e?.message || e);
  await prisma.$disconnect();
  process.exit(1);
});
