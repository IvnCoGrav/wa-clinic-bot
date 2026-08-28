import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { exec } from 'child_process';
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

const execAsync = promisify(exec);

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
      await execAsync('pg_dump --version');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Membuat file dump database yang dikompresi (.sql.gz)
   */
  public async createDatabaseDump(tenantId: string = DEFAULT_TENANT_ID): Promise<BackupResult> {
    ensureBackupDirectory();
    const fileName = generateBackupFileName();
    const filePath = path.join(BACKUP_STORAGE_DIR, fileName);

    const dbUrl = process.env.DATABASE_URL;
    const hasPgDump = await this.isPgDumpAvailable();

    if (hasPgDump && dbUrl && !dbUrl.includes('localhost') && !process.env.WAHA_MOCK) {
      try {
        // Jalankan pg_dump pipa ke gzip
        const cmd = `pg_dump "${dbUrl}" | gzip > "${filePath}"`;
        await execAsync(cmd);
      } catch (err: any) {
        console.warn('[BackupService] pg_dump command failed, falling back to programmatic dump:', err?.message);
        await this.createProgrammaticDump(filePath, tenantId);
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
   * Export database tables secara programatik menggunakan Prisma & gzip
   */
  private async createProgrammaticDump(filePath: string, tenantId: string): Promise<void> {
    let dumpData: any = {
      meta: {
        exportedAt: new Date().toISOString(),
        tenantId,
        version: '1.0',
      },
      tables: {},
    };

    try {
      // Ambil data tabel utama
      const [
        customers,
        children,
        reservations,
        services,
        deliveryTiers,
        staff,
        personas,
        aiConfigs,
        knowledgeChunks,
        conversations,
        messages,
      ] = await Promise.all([
        prisma.customer.findMany().catch(() => []),
        prisma.child.findMany().catch(() => []),
        prisma.reservation.findMany().catch(() => []),
        prisma.clinicService.findMany().catch(() => []),
        prisma.deliveryTier.findMany().catch(() => []),
        prisma.staff.findMany().catch(() => []),
        prisma.tenantPersona.findMany().catch(() => []),
        prisma.tenantAiConfig.findMany().catch(() => []),
        prisma.knowledgeChunk.findMany().catch(() => []),
        prisma.conversation.findMany().catch(() => []),
        prisma.message.findMany().catch(() => []),
      ]);

      dumpData.tables = {
        customers,
        children,
        reservations,
        services,
        deliveryTiers,
        staff,
        personas,
        aiConfigs,
        knowledgeChunks,
        conversations,
        messages,
      };
    } catch (err: any) {
      console.warn('[BackupService] Database read partially degraded during programmatic dump:', err?.message);
    }

    const jsonString = JSON.stringify(dumpData, null, 2);
    const compressed = zlib.gzipSync(Buffer.from(jsonString, 'utf-8'));
    fs.writeFileSync(filePath, compressed);
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
  public async restoreDatabaseFromDump(
    filePath: string,
    tenantId: string = DEFAULT_TENANT_ID
  ): Promise<{ success: boolean; message: string; tablesRestored: number }> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File backup tidak ditemukan pada lokasi: ${filePath}`);
    }

    let decompressed: string;
    if (isValidGzipHeader(filePath)) {
      const compressed = fs.readFileSync(filePath);
      try {
        decompressed = zlib.gunzipSync(compressed).toString('utf-8');
      } catch (err: any) {
        throw new Error(`Gagal mengekstrak isi file backup gzip: ${err?.message}`);
      }
    } else {
      // Plain text SQL / JSON file
      decompressed = fs.readFileSync(filePath, 'utf-8');
    }

    let tablesRestored = 0;
    const restoredSummary: string[] = [];

    // Cek apakah file berupa JSON dump programatik
    if (decompressed.trim().startsWith('{') && decompressed.includes('"tables"')) {
      try {
        const parsed = JSON.parse(decompressed);
        const tables = parsed.tables || {};

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
                where: { phone: c.phone },
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
              await prisma.child.upsert({
                where: { id: ch.id },
                update: {
                  name: ch.name,
                  birth_date: ch.birth_date ? new Date(ch.birth_date) : undefined,
                  age_months_at_registration: ch.age_months_at_registration,
                  raw_age_text: ch.raw_age_text,
                },
                create: {
                  ...ch,
                  birth_date: ch.birth_date ? new Date(ch.birth_date) : undefined,
                },
              });
            } catch {}
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
    } else {
      // Jika berupa SQL Dump mentah, jalankan eksekusi query
      try {
        await prisma.$executeRawUnsafe(decompressed);
        tablesRestored = 1;
        restoredSummary.push('SQL script eksekusi');
      } catch (err: any) {
        console.warn('[BackupService] Raw SQL restore partial error:', err?.message);
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
