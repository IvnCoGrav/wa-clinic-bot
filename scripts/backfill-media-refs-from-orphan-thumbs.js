#!/usr/bin/env node
/**
 * Backfill: pulihkan referensi media pada pesan yang `payload_raw`-nya rusak
 * (`{"unset":["media","hdUrl"]}`) akibat operasi JSON Prisma yang tidak sah.
 *
 * Strategi: thumbnail yang masih ada di disk tetapi tidak direferensikan pesan
 * mana pun ("yatim") dicocokkan ke pesan lewat waktu file ≈ created_at.
 * Hanya kecocokan TUNGGAL yang diterapkan; yang ambigu dilewati.
 *
 * Pengaman: thumbnail yang stem-nya masih dirujuk HD lain TIDAK dipakai,
 * agar tidak salah tempel gambar.
 *
 * Jalankan (di container produksi):
 *   docker cp scripts/backfill-media-refs-from-orphan-thumbs.js wa-clinic-bot-app-1:/app/bf-media.js
 *   docker exec wa-clinic-bot-app-1 node /app/bf-media.js --dry-run
 *   docker exec wa-clinic-bot-app-1 node /app/bf-media.js --apply
 *   docker exec wa-clinic-bot-app-1 node /app/bf-media.js --apply --tolerance=20000
 */
'use strict';

const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();
const MEDIA_ROOT = path.join(process.cwd(), 'storage', 'media');
const DEFAULT_TOLERANCE_MS = 5000;

function listThumbFiles(tenantId) {
  const out = [];
  for (const scope of ['inbound', 'outbound']) {
    const dir = path.join(MEDIA_ROOT, scope, tenantId);
    let names = [];
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
        out.push({ relUrl: `/media/${scope}/${tenantId}/${name}`, fullPath, mtimeMs: st.mtimeMs, scope });
      } catch {
        /* file hilang saat dibaca */
      }
    }
  }
  return out;
}

/**
 * Folder penyimpanan yang benar untuk sebuah pesan:
 * - customer masuk → inbound
 * - balasan dari WhatsApp HP (webhook) → inbound (memakai saveInboundMedia)
 * - bot / admin dashboard → outbound
 */
function expectedScope(msg) {
  if (msg.direction === 'INBOUND') return 'inbound';
  if (String(msg.sender_name || '').includes('WhatsApp HP')) return 'inbound';
  return 'outbound';
}

function esc(v) {
  return `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--apply');
  const tenantArg = args.find((a) => a.startsWith('--tenant='));
  const tenantId = tenantArg ? tenantArg.split('=')[1] : 'default-tenant';
  const tolArg = args.find((a) => a.startsWith('--tolerance='));
  const toleranceMs = tolArg ? Number(tolArg.split('=')[1]) || DEFAULT_TOLERANCE_MS : DEFAULT_TOLERANCE_MS;

  console.log(`[BACKFILL-MEDIA] Mode: ${dryRun ? 'DRY-RUN' : 'APPLY'} | tenant=${tenantId} | toleransi=${toleranceMs}ms`);

  const affected = await prisma.$queryRaw`
    SELECT id, conversation_id, direction, sender_name, left(coalesce(content,''), 120) AS content, created_at
    FROM messages
    WHERE tenant_id = ${tenantId} AND payload_raw->>'unset' IS NOT NULL
    ORDER BY created_at ASC
  `;
  console.log(`[BACKFILL-MEDIA] Pesan rusak: ${affected.length}`);
  if (affected.length === 0) {
    await prisma.$disconnect();
    return;
  }

  const refs = new Set();
  const refStems = new Set();
  const addRef = (u) => {
    if (typeof u !== 'string' || !u.startsWith('/media/')) return;
    refs.add(u);
    refStems.add(u.replace(/\.\w+$/, '').replace(/_thumb$/, ''));
  };

  const msgRefs = await prisma.$queryRaw`
    SELECT payload_raw->'media'->>'url' AS u FROM messages WHERE tenant_id = ${tenantId}
    UNION SELECT payload_raw->'media'->>'hdUrl' FROM messages WHERE tenant_id = ${tenantId}
    UNION SELECT payload_raw->'media'->>'thumbUrl' FROM messages WHERE tenant_id = ${tenantId}
  `;
  msgRefs.forEach((r) => addRef(r.u));

  const custRefs = await prisma.$queryRaw`
    SELECT preferences->>'house_photo_url' AS u FROM customers WHERE tenant_id = ${tenantId}
  `;
  custRefs.forEach((r) => addRef(r.u));

  const tenantRow = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { pricelist_image_url: true } });
  if (tenantRow) addRef(tenantRow.pricelist_image_url);

  const orphans = listThumbFiles(tenantId).filter((f) => {
    if (refs.has(f.relUrl)) return false;
    const stem = f.relUrl.replace(/\.\w+$/, '').replace(/_thumb$/, '');
    if (refStems.has(stem)) return false; // thumb dari HD yang masih dirujuk
    return true;
  });
  console.log(`[BACKFILL-MEDIA] Thumbnail yatim aman dipakai: ${orphans.length}`);

  const used = new Set();
  const matches = [];
  let ambiguous = 0;
  let noMatch = 0;

  for (const msg of affected) {
    const t = new Date(msg.created_at).getTime();
    const scope = expectedScope(msg);
    const candidates = orphans.filter(
      (f) => f.scope === scope && !used.has(f.relUrl) && Math.abs(f.mtimeMs - t) <= toleranceMs
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

  const csv = ['message_id,conversation_id,direction,sender_name,created_at,content,matched_thumb,status'];
  for (const m of matches) {
    csv.push([
      m.msg.id,
      m.msg.conversation_id,
      m.msg.direction,
      m.msg.sender_name,
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
  } catch (e) {
    console.warn(`[BACKFILL-MEDIA] Gagal menulis CSV: ${(e && e.message) || e}`);
  }

  console.log(
    `[BACKFILL-MEDIA] cocok=${matches.length} | ambigu=${ambiguous} | tanpa_file=${noMatch} | ${dryRun ? 'belum diterapkan' : `diterapkan=${applied}`}`
  );

  if (matches.length > 0) {
    console.log('[BACKFILL-MEDIA] Sampel 5 pertama:');
    for (const m of matches.slice(0, 5)) {
      console.log(
        `  - ${m.msg.id} | ${new Date(m.msg.created_at).toISOString()} | ${m.file.relUrl} | ${String(m.msg.content || '').replace(/\n/g, ' ').slice(0, 50)}`
      );
    }
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('[BACKFILL-MEDIA] FATAL:', (e && e.message) || e);
  await prisma.$disconnect();
  process.exit(1);
});
