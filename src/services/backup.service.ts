import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { googleOAuthClientManager } from '../integrations/google-contacts/google-oauth.client';
import { googleDriveBackupClient, DriveBackupFile } from '../integrations/google-drive/client';
import {
  ensureBackupDirectory,
  generateBackupFileName,
  sanitizeBackupFileName,
  isValidGzipHeader,
  BACKUP_STORAGE_DIR,
} from '../utils/backup-file';
import {
  getBackupEncryptionKey,
  encryptBufferWithKey,
  decryptBufferWithKey,
  isEncryptedBackupBuffer,
} from '../utils/encryption';

const execFileAsync = promisify(execFile);

/** Ukuran minimum dump SQL agar file kosong/terpotong tidak dianggap backup sah. */
const MIN_SQL_DUMP_BYTES = 1024;

export interface BackupItem {
  id: string;
  name: string;
  sizeBytes: number;
  createdAt: Date;
  source: 'local' | 'google_drive';
  webViewLink?: string;
}

export interface BackupResult {
  filePath: string;
  fileName: string;
  sizeBytes: number;
  googleDriveFile?: DriveBackupFile;
}

export class BackupService {
  /**
   * Mengecek apakah pg_dump tersedia di environment host / container
   */
  private async isPgDumpAvailable(): Promise<boolean> {
    try {
      await execFileAsync('pg_dump', ['--version']);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Membuat file dump database yang dikompresi (.sql.gz)
   */
  public async createDatabaseDump(
    tenantId: string = DEFAULT_TENANT_ID,
    options?: { prefix?: string }
  ): Promise<BackupResult> {
    ensureBackupDirectory();
    const fileName = generateBackupFileName(options?.prefix || 'wa_clinic_backup');
    const filePath = path.join(BACKUP_STORAGE_DIR, fileName);

    const dbUrl = process.env.DATABASE_URL;
    const hasPgDump = await this.isPgDumpAvailable();

    if (hasPgDump && dbUrl && !dbUrl.includes('localhost') && !process.env.WAHA_MOCK) {
      // Task 3.4 / backup SQL: jangan pakai pipeline shell `pg_dump | gzip`.
      // Pipeline tanpa pipefail dapat mengembalikan exit 0 walau pg_dump gagal,
      // sehingga terbentuk gzip kosong yang tampak "sukses". Tulis SQL ke file
      // sementara, validasi header/ukuran, lalu gzip + enkripsi di Node.
      const tmpSqlPath = `${filePath}.tmp.sql`;
      try {
        await execFileAsync(
          'pg_dump',
          ['--no-owner', '--no-privileges', '--file', tmpSqlPath, dbUrl],
          { maxBuffer: 16 * 1024 * 1024 }
        );

        if (!fs.existsSync(tmpSqlPath)) {
          throw new Error('pg_dump tidak menghasilkan file dump.');
        }
        const sqlStat = fs.statSync(tmpSqlPath);
        if (sqlStat.size < MIN_SQL_DUMP_BYTES) {
          throw new Error(`Dump SQL terlalu kecil (${sqlStat.size} bytes); kemungkinan kosong/terpotong.`);
        }

        const sqlBuffer = fs.readFileSync(tmpSqlPath);
        const header = sqlBuffer.subarray(0, Math.min(4096, sqlBuffer.length)).toString('utf-8');
        const isPostgresDump =
          header.includes('PostgreSQL database dump') ||
          /(^|\n)CREATE TABLE\s/i.test(header) ||
          /(^|\n)COPY\s+\S+\s+FROM\s+stdin/i.test(header);
        if (!isPostgresDump) {
          throw new Error('Header dump SQL tidak dikenali; file bukan pg_dump plain-format yang sah.');
        }

        const compressed = zlib.gzipSync(sqlBuffer);
        const key = getBackupEncryptionKey();
        const encrypted = encryptBufferWithKey(compressed, key);
        fs.writeFileSync(filePath, encrypted);
      } catch (err: any) {
        console.error('[BackupService] pg_dump command failed:', err?.message);
        throw new Error(`pg_dump gagal menghasilkan backup: ${err?.message}`);
      } finally {
        try {
          if (fs.existsSync(tmpSqlPath)) fs.unlinkSync(tmpSqlPath);
        } catch {}
      }
    } else {
      // Fallback programmatic dump (kompatibel lintas platform Windows/Linux & offline tests)
      await this.createProgrammaticDump(filePath, tenantId);
    }

    const stat = fs.statSync(filePath);
    console.log(`[BackupService] Backup created successfully: ${fileName} (${stat.size} bytes)`);

    return {
      filePath,
      fileName,
      sizeBytes: stat.size,
    };
  }

  /**
   * Export database tables secara programatik menggunakan Prisma, gzip & AES-256-GCM
   */
  private async createProgrammaticDump(filePath: string, tenantId: string): Promise<void> {
    // Task 3.1 & 3.2: Fail-closed (tanpa .catch(() => [])) agar pembacaan tabel yang gagal membatalkan backup
    const [
      customers,
      children,
      reservations,
      reservationArchives,
      services,
      deliveryTiers,
      staff,
      personas,
      aiConfigs,
      knowledgeChunks,
      conversations,
      messages,
    ] = await Promise.all([
      prisma.customer.findMany(),
      prisma.child.findMany(),
      prisma.reservation.findMany(),
      prisma.reservationArchive.findMany(),
      prisma.clinicService.findMany(),
      prisma.deliveryTier.findMany(),
      prisma.staff.findMany(),
      prisma.tenantPersona.findMany(),
      prisma.tenantAiConfig.findMany(),
      prisma.knowledgeChunk.findMany(),
      prisma.conversation.findMany(),
      prisma.message.findMany(),
    ]);

    const tableCounts: Record<string, number> = {
      customers: customers.length,
      children: children.length,
      reservations: reservations.length,
      reservationArchives: reservationArchives.length,
      services: services.length,
      deliveryTiers: deliveryTiers.length,
      staff: staff.length,
      personas: personas.length,
      aiConfigs: aiConfigs.length,
      knowledgeChunks: knowledgeChunks.length,
      conversations: conversations.length,
      messages: messages.length,
    };

    const dumpData: any = {
      meta: {
        schemaVersion: '2.0',
        exportedAt: new Date().toISOString(),
        tenantId,
        tableCounts,
        format: 'JSON_GZIP_ENCRYPTED_V1',
      },
      tables: {
        customers,
        children,
        reservations,
        reservationArchives,
        services,
        deliveryTiers,
        staff,
        personas,
        aiConfigs,
        knowledgeChunks,
        conversations,
        messages,
      },
    };

    const crypto = await import('crypto');
    const jsonString = JSON.stringify(dumpData, null, 2);
    const checksum = crypto.createHash('sha256').update(jsonString, 'utf8').digest('hex');
    dumpData.meta.sha256 = checksum;

    const finalJson = JSON.stringify(dumpData, null, 2);
    const compressed = zlib.gzipSync(Buffer.from(finalJson, 'utf-8'));

    // Task 3.4: Enkripsi dengan BACKUP_ENCRYPTION_KEY sebelum ditulis ke disk
    const { getBackupEncryptionKey, encryptBufferWithKey } = await import('../utils/encryption');
    const key = getBackupEncryptionKey();
    const encrypted = encryptBufferWithKey(compressed, key);
    fs.writeFileSync(filePath, encrypted);
  }

  /**
   * Unggah file backup ke Google Drive
   */
  public async uploadToGoogleDrive(
    tenantId: string = DEFAULT_TENANT_ID,
    specificFilePath?: string
  ): Promise<DriveBackupFile | null> {
    let targetPath = specificFilePath;

    if (!targetPath) {
      const dump = await this.createDatabaseDump(tenantId);
      targetPath = dump.filePath;
    }

    if (!fs.existsSync(targetPath)) {
      throw new Error(`File backup tidak ditemukan: ${targetPath}`);
    }

    const stat = fs.statSync(targetPath);
    if (stat.size === 0) {
      throw new Error(`File backup kosong (0 bytes): ${targetPath}`);
    }

    // Task 3.5: Verifikasi integritas & dekripsi sebelum upload
    const counts = this.getBackupFileCounts(targetPath);
    if (!counts) {
      throw new Error(`File backup korup atau tidak dapat didekripsi/diverifikasi: ${targetPath}`);
    }

    const authClient = await googleOAuthClientManager.getAuthenticatedClient(tenantId);
    if (!authClient) {
      console.warn(`[BackupService] Akun Google belum terhubung untuk tenant ${tenantId}. Lewati upload Google Drive.`);
      return null;
    }

    const fileName = path.basename(targetPath);
    const folderId = await googleDriveBackupClient.ensureBackupFolder(authClient);
    const uploadedFile = await googleDriveBackupClient.uploadBackupFile(authClient, targetPath, fileName, folderId);

    // Otomatis bersihkan backup lama di Drive (retensi 8 file terakhir)
    await googleDriveBackupClient.pruneOldBackups(authClient, folderId, 8);

    // Catat ke audit log jika DB online
    try {
      await prisma.auditLog.create({
        data: {
          tenant_id: tenantId,
          admin_key: 'SYSTEM',
          admin_identity: 'SYSTEM_CRON',
          action: 'UPLOAD_BACKUP_GOOGLE_DRIVE',
          payload: JSON.stringify({ fileName, driveFileId: uploadedFile.id }),
        },
      });
    } catch {
      // Degrade silently
    }

    return uploadedFile;
  }

  /**
   * Mengambil seluruh daftar backup (lokal & Google Drive)
   */
  public async listAllBackups(tenantId: string = DEFAULT_TENANT_ID): Promise<BackupItem[]> {
    ensureBackupDirectory();
    const items: BackupItem[] = [];

    // 1. Baca backup lokal
    try {
      const files = fs.readdirSync(BACKUP_STORAGE_DIR);
      for (const file of files) {
        if (file.endsWith('.sql.gz') || file.endsWith('.json.gz')) {
          const fullPath = path.join(BACKUP_STORAGE_DIR, file);
          const stat = fs.statSync(fullPath);
          items.push({
            id: file,
            name: file,
            sizeBytes: stat.size,
            createdAt: stat.birthtime || stat.mtime,
            source: 'local',
          });
        }
      }
    } catch (err: any) {
      console.warn('[BackupService] Gagal membaca direktori backup lokal:', err?.message);
    }

    // 2. Baca backup dari Google Drive jika terhubung
    try {
      const authClient = await googleOAuthClientManager.getAuthenticatedClient(tenantId);
      if (authClient) {
        const folderId = await googleDriveBackupClient.ensureBackupFolder(authClient);
        const driveFiles = await googleDriveBackupClient.listBackups(authClient, folderId);
        for (const df of driveFiles) {
          items.push({
            id: df.id,
            name: df.name,
            sizeBytes: df.sizeBytes,
            createdAt: df.createdTime,
            source: 'google_drive',
            webViewLink: df.webViewLink,
          });
        }
      }
    } catch (err: any) {
      console.warn('[BackupService] Gagal mengambil daftar backup dari Google Drive:', err?.message);
    }

    // Urutkan dari yang terbaru
    return items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /**
   * Restore database dari file dump .sql.gz / .sql / .json.gz
   */

  /**
   * Ekstrak ringkasan jumlah baris tabel dari file backup untuk validasi kelengkapan
   */
  public getBackupFileCounts(filePath: string): Record<string, number> | null {
    try {
      if (!fs.existsSync(filePath)) return null;
      const rawBytes = fs.readFileSync(filePath);
      let payloadToGunzip: Buffer = rawBytes;
      if (isEncryptedBackupBuffer(rawBytes)) {
        const key = getBackupEncryptionKey();
        payloadToGunzip = decryptBufferWithKey(rawBytes, key);
      }

      let decompressed: string;
      if (payloadToGunzip.length >= 2 && payloadToGunzip[0] === 0x1f && payloadToGunzip[1] === 0x8b) {
        decompressed = zlib.gunzipSync(payloadToGunzip).toString('utf-8');
      } else {
        decompressed = payloadToGunzip.toString('utf-8');
      }
      const trimmed = decompressed.trim();
      if (trimmed.startsWith('{')) {
        const parsed = JSON.parse(decompressed);
        if (parsed.meta?.tableCounts) return parsed.meta.tableCounts;
        if (parsed.tables) {
          const counts: Record<string, number> = {};
          for (const [table, rows] of Object.entries(parsed.tables)) {
            counts[table] = Array.isArray(rows) ? rows.length : 0;
          }
          return counts;
        }
        return null;
      }

      // Backup produksi memakai `pg_dump` plain-format (SQL), bukan JSON.
      // Verifikasi integritas SQL: gzip sudah berhasil didekompresi (CRC valid)
      // dan header dump PostgreSQL dikenali. Jumlah baris per tabel tidak
      // tersedia untuk SQL; kembalikan sentinel agar upload tetap lolos
      // verifikasi format-aware tanpa memalsukan table counts.
      if (trimmed.length < MIN_SQL_DUMP_BYTES) return null;
      const isPostgresDump =
        trimmed.includes('PostgreSQL database dump') ||
        /(^|\n)CREATE TABLE\s/i.test(trimmed) ||
        /(^|\n)COPY\s+\S+\s+FROM\s+stdin/i.test(trimmed);
      if (isPostgresDump) {
        return { __format_sql: 1 };
      }
      return null;
    } catch {
      return null;
    }
  }

  public async restoreDatabaseFromDump(
    filePath: string,
    tenantId: string = DEFAULT_TENANT_ID,
    options?: { force?: boolean }
  ): Promise<{ success: boolean; message: string; tablesRestored: number }> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File backup tidak ditemukan pada lokasi: ${filePath}`);
    }

    const rawBytes = fs.readFileSync(filePath);
    let payloadToGunzip: Buffer = rawBytes;
    if (isEncryptedBackupBuffer(rawBytes)) {
      try {
        const key = getBackupEncryptionKey();
        payloadToGunzip = decryptBufferWithKey(rawBytes, key);
      } catch (err: any) {
        throw new Error(`Gagal mendekripsi file backup terenkripsi: ${err?.message}`);
      }
    }

    let decompressed: string;
    if (payloadToGunzip.length >= 2 && payloadToGunzip[0] === 0x1f && payloadToGunzip[1] === 0x8b) {
      try {
        decompressed = zlib.gunzipSync(payloadToGunzip).toString('utf-8');
      } catch (err: any) {
        throw new Error(`Gagal mengekstrak isi file backup gzip: ${err?.message}`);
      }
    } else {
      // Plain text SQL / JSON file
      decompressed = payloadToGunzip.toString('utf-8');
    }

    let tablesRestored = 0;
    const restoredSummary: string[] = [];

    // SEC-AUDIT-06: HANYA format dump JSON internal (per-entitas via Prisma ORM)
    // yang boleh direstore. Dump SQL mentah DITOLAK — $executeRawUnsafe atas file
    // upload = eksekusi SQL sewenang-wenang (DROP/credential theft).
    const isProgrammaticJson = decompressed.trim().startsWith('{') && decompressed.includes('"tables"');
    if (!isProgrammaticJson) {
      throw new Error(
        'Format backup tidak didukung untuk restore. Hanya dump JSON internal (.json.gz) yang diizinkan; ' +
          'dump SQL mentah (.sql/.sql.gz) harus dipulihkan manual via pg_restore oleh operator.'
      );
    }

    let parsed: any;
    try {
      parsed = JSON.parse(decompressed);
    } catch (err: any) {
      throw new Error(`Format JSON tidak valid dalam file backup: ${err?.message}`);
    }

    // Verifikasi checksum SHA-256 manifest jika tersedia
    if (parsed.meta && typeof parsed.meta.sha256 === 'string' && parsed.meta.sha256.length === 64) {
      const expectedChecksum = parsed.meta.sha256;
      const crypto = await import('crypto');
      const clone = { ...parsed, meta: { ...parsed.meta } };
      delete clone.meta.sha256;
      const computed = crypto.createHash('sha256').update(JSON.stringify(clone, null, 2), 'utf8').digest('hex');
      if (computed !== expectedChecksum) {
        throw new Error(`Integritas backup gagal: checksum SHA-256 tidak cocok (${computed} !== ${expectedChecksum}). File mungkin korup atau dimanipulasi.`);
      }
    }

    const tables = parsed.tables || {};

    // I-002: dump lintas tenant DILARANG direstore ke tenant lain.
    const dumpTenantId = parsed?.meta?.tenantId;
    if (dumpTenantId && dumpTenantId !== tenantId) {
      throw new Error(
        `Backup milik tenant '${dumpTenantId}' tidak boleh direstore ke tenant '${tenantId}'.`
      );
    }
    for (const [tableName, rows] of Object.entries(tables)) {
      if (!Array.isArray(rows)) continue;
      const foreign = (rows as any[]).find(
        (row) => row && typeof row === 'object' && row.tenant_id && row.tenant_id !== tenantId
      );
      if (foreign) {
        throw new Error(
          `Backup terkontaminasi: tabel '${tableName}' memuat baris tenant '${foreign.tenant_id}' (target '${tenantId}'). Restore dibatalkan.`
        );
      }
    }

    // 6.3 Validasi kelengkapan data (Completeness Guard)
    // Cek apakah jumlah baris pada backup turun > 20% dibanding data aktif di DB atau backup sebelumnya
    if (!options?.force) {
      const incomingResCount = Array.isArray(tables.reservations) ? tables.reservations.length : 0;
      const incomingCustCount = Array.isArray(tables.customers) ? tables.customers.length : 0;

      // 1. Cek terhadap data aktif DB saat ini
      const [currentResCount, currentCustCount] = await Promise.all([
        prisma.reservation.count({ where: { tenant_id: tenantId } }).catch(() => 0),
        prisma.customer.count({ where: { tenant_id: tenantId } }).catch(() => 0),
      ]);

      // 2. Cek terhadap backup sebelumnya jika ada
      let prevBackupResCount = 0;
      let prevBackupCustCount = 0;

      const baseName = path.basename(filePath);
      const tsMatch = baseName.match(/wa_clinic_backup_(\d{8}_\d{6})/);

      if (tsMatch) {
        try {
          const files = fs.readdirSync(BACKUP_STORAGE_DIR);
          const olderBackups = files
            .map((f) => {
              const m = f.match(/wa_clinic_backup_(\d{8}_\d{6})/);
              return { file: f, timestamp: m ? m[1] : null };
            })
            .filter((item) => {
              if (!item.timestamp) return false;
              if (path.join(BACKUP_STORAGE_DIR, item.file) === filePath) return false;
              return item.timestamp < tsMatch[1];
            })
            .sort((a, b) => b.timestamp!.localeCompare(a.timestamp!));

          if (olderBackups.length > 0) {
            const predecessorPath = path.join(BACKUP_STORAGE_DIR, olderBackups[0].file);
            const predCounts = this.getBackupFileCounts(predecessorPath);
            if (predCounts) {
              prevBackupResCount = predCounts.reservations || 0;
              prevBackupCustCount = predCounts.customers || 0;
            }
          }
        } catch {}
      }

      const baselineRes = Math.max(currentResCount, prevBackupResCount);
      const baselineCust = Math.max(currentCustCount, prevBackupCustCount);

      const drops: string[] = [];

      if (baselineRes > 0 && incomingResCount < baselineRes) {
        const dropPercent = ((baselineRes - incomingResCount) / baselineRes) * 100;
        if (dropPercent > 20) {
          drops.push(`reservasi turun ${Math.round(dropPercent)}% (${incomingResCount} vs ${baselineRes})`);
        }
      }

      if (baselineCust > 0 && incomingCustCount < baselineCust) {
        const dropPercent = ((baselineCust - incomingCustCount) / baselineCust) * 100;
        if (dropPercent > 20) {
          drops.push(`pasien turun ${Math.round(dropPercent)}% (${incomingCustCount} vs ${baselineCust})`);
        }
      }

      if (drops.length > 0) {
        const errorMsg = `Validasi kelengkapan backup gagal (INCOMPLETE): ${drops.join(', ')}. Pemulihan dibatalkan untuk mencegah kehilangan data massal. Gunakan opsi force=true jika memang ingin memulihkan backup ini.`;
        try {
          await prisma.auditLog.create({
            data: {
              tenant_id: tenantId,
              admin_key: 'ADMIN',
              admin_identity: 'ADMIN_MANUAL',
              action: 'RESTORE_DATABASE_REJECTED_INCOMPLETE',
              payload: JSON.stringify({
                fileName: path.basename(filePath),
                incomingResCount,
                baselineRes,
                incomingCustCount,
                baselineCust,
                drops,
              }),
            },
          });
        } catch {}
        throw new Error(errorMsg);
      }
    }

    {
      try {
        // 1. Pulihkan Staff
        if (Array.isArray(tables.staff) && tables.staff.length > 0) {
          for (const st of tables.staff) {
            try {
              await prisma.staff.upsert({
                where: { phone: st.phone },
                update: {
                  name: st.name,
                  password_hash: st.password_hash,
                  role: st.role,
                  active: st.active ?? true,
                  tenant_id: st.tenant_id || tenantId,
                },
                create: {
                  ...st,
                  tenant_id: st.tenant_id || tenantId,
                },
              });
            } catch {}
          }
          restoredSummary.push(`${tables.staff.length} staff`);
          tablesRestored++;
        }

        // 2. Pulihkan Customer
        if (Array.isArray(tables.customers) && tables.customers.length > 0) {
          for (const c of tables.customers) {
            try {
              await prisma.customer.upsert({
                where: {
                  tenant_id_phone: {
                    tenant_id: c.tenant_id || tenantId,
                    phone: c.phone,
                  },
                },
                update: {
                  name: c.name,
                  kelurahan: c.kelurahan,
                  kecamatan: c.kecamatan,
                  kota: c.kota,
                  lat: c.lat,
                  lng: c.lng,
                  distance_km: c.distance_km,
                  ongkir: c.ongkir,
                  tenant_id: c.tenant_id || tenantId,
                },
                create: {
                  ...c,
                  tenant_id: c.tenant_id || tenantId,
                },
              });
            } catch {}
          }
          restoredSummary.push(`${tables.customers.length} pasien`);
          tablesRestored++;
        }

        // 3. Pulihkan Anak (Children)
        if (Array.isArray(tables.children) && tables.children.length > 0) {
          for (const ch of tables.children) {
            try {
              const nameNorm = ch.name_norm || (ch.name ? ch.name.trim().toLowerCase() : '');
              await prisma.child.upsert({
                where: { id: ch.id },
                update: {
                  name: ch.name,
                  name_norm: nameNorm,
                  birth_date: ch.birth_date ? new Date(ch.birth_date) : undefined,
                  age_months_at_registration: ch.age_months_at_registration,
                  raw_age_text: ch.raw_age_text,
                  first_reservation_id: ch.first_reservation_id ?? undefined,
                  last_reservation_id: ch.last_reservation_id ?? undefined,
                },
                create: {
                  ...ch,
                  name_norm: nameNorm,
                  birth_date: ch.birth_date ? new Date(ch.birth_date) : undefined,
                  first_reservation_id: ch.first_reservation_id || ch.reservation_id || null,
                  last_reservation_id: ch.last_reservation_id || ch.reservation_id || null,
                },
              });
            } catch (err: any) {
              console.warn(`[BackupRestore] Gagal memulihkan child ${ch.id}:`, err?.message || err);
            }
          }
          restoredSummary.push(`${tables.children.length} data anak`);
          tablesRestored++;
        }

        // 4. Pulihkan Layanan Treatment (Clinic Services)
        if (Array.isArray(tables.services) && tables.services.length > 0) {
          for (const s of tables.services) {
            try {
              await prisma.clinicService.upsert({
                where: { id: s.id },
                update: {
                  name: s.name,
                  service_id: s.service_id,
                  category: s.category,
                  age_label: s.age_label,
                  min_age_months: s.min_age_months,
                  max_age_months: s.max_age_months,
                  original_price: s.original_price,
                  promo_price: s.promo_price,
                  duration_minutes: s.duration_minutes,
                  is_active: s.is_active ?? true,
                  description: s.description,
                  tenant_id: s.tenant_id || tenantId,
                },
                create: {
                  ...s,
                  tenant_id: s.tenant_id || tenantId,
                },
              });
            } catch {}
          }
          restoredSummary.push(`${tables.services.length} layanan treatment`);
          tablesRestored++;
        }

        // 5. Pulihkan Tier Ongkir (Delivery Tiers)
        if (Array.isArray(tables.deliveryTiers) && tables.deliveryTiers.length > 0) {
          try {
            await prisma.deliveryTier.deleteMany({
              where: { tenant_id: tenantId },
            });
          } catch {}

          for (const dt of tables.deliveryTiers) {
            try {
              await prisma.deliveryTier.create({
                data: {
                  id: dt.id,
                  max_dist: dt.max_dist,
                  fee: dt.fee,
                  promo_discount: dt.promo_discount,
                  sort_order: dt.sort_order ?? 1,
                  tenant_id: dt.tenant_id || tenantId,
                },
              });
            } catch {}
          }
          restoredSummary.push(`${tables.deliveryTiers.length} tier ongkir`);
          tablesRestored++;
        }

        // 6. Pulihkan Reservasi
        if (Array.isArray(tables.reservations) && tables.reservations.length > 0) {
          for (const r of tables.reservations) {
            try {
              await prisma.reservation.upsert({
                where: { id: r.id },
                update: {
                  status: r.status,
                  treatment_category: r.treatment_category,
                  treatment_detail: r.treatment_detail,
                  booking_date: r.booking_date ? new Date(r.booking_date) : undefined,
                  purchase_value: r.purchase_value,
                  payment_method: r.payment_method,
                  proof_url: r.proof_url,
                },
                create: {
                  ...r,
                  created_at: r.created_at ? new Date(r.created_at) : new Date(),
                  booking_date: r.booking_date ? new Date(r.booking_date) : undefined,
                },
              });
            } catch {}
          }
          restoredSummary.push(`${tables.reservations.length} reservasi`);
          tablesRestored++;
        }

        // 6b. Pulihkan Arsip Reservasi (Reservation Archives)
        if (Array.isArray(tables.reservationArchives) && tables.reservationArchives.length > 0) {
          for (const a of tables.reservationArchives) {
            try {
              await prisma.reservationArchive.upsert({
                where: { id: a.id },
                update: {
                  tenant_id: a.tenant_id || tenantId,
                  reservation_id: a.reservation_id,
                  customer_id: a.customer_id,
                  customer_phone: a.customer_phone,
                  customer_name: a.customer_name,
                  booking_date: a.booking_date ? new Date(a.booking_date) : undefined,
                  status: a.status,
                  treatment_detail: a.treatment_detail,
                  purchase_value: a.purchase_value,
                  reason: a.reason,
                  archived_by: a.archived_by,
                  archived_at: a.archived_at ? new Date(a.archived_at) : new Date(),
                  restore_until: a.restore_until ? new Date(a.restore_until) : new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
                  payload: a.payload,
                  restored_at: a.restored_at ? new Date(a.restored_at) : undefined,
                },
                create: {
                  ...a,
                  tenant_id: a.tenant_id || tenantId,
                  booking_date: a.booking_date ? new Date(a.booking_date) : undefined,
                  archived_at: a.archived_at ? new Date(a.archived_at) : new Date(),
                  restore_until: a.restore_until ? new Date(a.restore_until) : new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
                  restored_at: a.restored_at ? new Date(a.restored_at) : undefined,
                },
              });
            } catch (err: any) {
              console.warn(`[BackupRestore] Gagal memulihkan archive ${a.id}:`, err?.message || err);
            }
          }
          restoredSummary.push(`${tables.reservationArchives.length} arsip reservasi`);
          tablesRestored++;
        }

        // 7. Pulihkan Persona & AI Config
        if (Array.isArray(tables.personas) && tables.personas.length > 0) {
          for (const p of tables.personas) {
            try {
              await prisma.tenantPersona.upsert({
                where: { id: p.id },
                update: { ...p },
                create: { ...p },
              });
            } catch {}
          }
          tablesRestored++;
        }

        if (Array.isArray(tables.aiConfigs) && tables.aiConfigs.length > 0) {
          for (const a of tables.aiConfigs) {
            try {
              const { id: _id, ...rest } = a;
              await prisma.tenantAiConfig.upsert({
                where: { tenant_id_task: { tenant_id: a.tenant_id, task: a.task } },
                update: { ...rest },
                create: { ...a },
              });
            } catch {}
          }
          tablesRestored++;
        }

        // 8. Pulihkan Knowledge Base
        if (Array.isArray(tables.knowledgeChunks) && tables.knowledgeChunks.length > 0) {
          for (const k of tables.knowledgeChunks) {
            try {
              await prisma.knowledgeChunk.upsert({
                where: { id: k.id },
                update: { ...k },
                create: { ...k },
              });
            } catch {}
          }
          restoredSummary.push(`${tables.knowledgeChunks.length} knowledge chunks`);
          tablesRestored++;
        }

        // 9. Pulihkan Percakapan (Conversations)
        if (Array.isArray(tables.conversations) && tables.conversations.length > 0) {
          for (const conv of tables.conversations) {
            try {
              await prisma.conversation.upsert({
                where: { id: conv.id },
                update: {
                  current_state: conv.current_state,
                  previous_state: conv.previous_state,
                  is_human_handling: conv.is_human_handling,
                  human_handling_since: conv.human_handling_since ? new Date(conv.human_handling_since) : undefined,
                  last_message_at: conv.last_message_at ? new Date(conv.last_message_at) : new Date(),
                  last_customer_message_at: conv.last_customer_message_at ? new Date(conv.last_customer_message_at) : undefined,
                  is_pinned: conv.is_pinned ?? false,
                  is_manual_unread: conv.is_manual_unread ?? false,
                  escalation_reason: conv.escalation_reason,
                  review_flagged: conv.review_flagged ?? false,
                },
                create: {
                  ...conv,
                  created_at: conv.created_at ? new Date(conv.created_at) : new Date(),
                  last_message_at: conv.last_message_at ? new Date(conv.last_message_at) : new Date(),
                  last_customer_message_at: conv.last_customer_message_at ? new Date(conv.last_customer_message_at) : undefined,
                  human_handling_since: conv.human_handling_since ? new Date(conv.human_handling_since) : undefined,
                  pinned_at: conv.pinned_at ? new Date(conv.pinned_at) : undefined,
                },
              });
            } catch {}
          }
          restoredSummary.push(`${tables.conversations.length} percakapan`);
          tablesRestored++;
        }

        // 10. Pulihkan Pesan (Messages)
        if (Array.isArray(tables.messages) && tables.messages.length > 0) {
          for (const m of tables.messages) {
            try {
              await prisma.message.upsert({
                where: { id: m.id },
                update: {
                  content: m.content,
                  direction: m.direction,
                  sender_type: m.sender_type,
                  sender_name: m.sender_name,
                  payload_raw: m.payload_raw,
                  delivery_status: m.delivery_status,
                  is_revoked: m.is_revoked ?? false,
                  delivered_at: m.delivered_at ? new Date(m.delivered_at) : undefined,
                  read_at: m.read_at ? new Date(m.read_at) : undefined,
                },
                create: {
                  ...m,
                  created_at: m.created_at ? new Date(m.created_at) : new Date(),
                  delivered_at: m.delivered_at ? new Date(m.delivered_at) : undefined,
                  read_at: m.read_at ? new Date(m.read_at) : undefined,
                  revoked_at: m.revoked_at ? new Date(m.revoked_at) : undefined,
                },
              });
            } catch {}
          }
          restoredSummary.push(`${tables.messages.length} pesan chat`);
          tablesRestored++;
        }
      } catch (err: any) {
        console.warn('[BackupService] Partial error during JSON restore:', err?.message);
      }
    }

    // Audit Log
    try {
      await prisma.auditLog.create({
        data: {
          tenant_id: tenantId,
          admin_key: 'ADMIN',
          admin_identity: 'ADMIN_MANUAL',
          action: 'RESTORE_DATABASE',
          payload: JSON.stringify({
            fileName: path.basename(filePath),
            tablesRestored,
            summary: restoredSummary.join(', '),
          }),
        },
      });
    } catch {
      // Degrade silently
    }

    const detailMsg = restoredSummary.length > 0 ? ` (${restoredSummary.join(', ')})` : '';

    return {
      success: true,
      message: `Database berhasil dipulihkan dari file ${path.basename(filePath)}${detailMsg}.`,
      tablesRestored,
    };
  }
}

export const backupService = new BackupService();
