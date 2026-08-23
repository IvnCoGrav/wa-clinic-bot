import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';

export interface DriveBackupFile {
  id: string;
  name: string;
  sizeBytes: number;
  createdTime: Date;
  webViewLink?: string;
}

export class GoogleDriveBackupClient {
  private folderName: string;

  constructor(folderName = 'Kala Clinic Bot Backups') {
    this.folderName = folderName;
  }

  /**
   * Mendapatkan atau membuat folder khusus backup di Google Drive pengguna
   */
  public async ensureBackupFolder(authClient: any): Promise<string> {
    const drive = google.drive({ version: 'v3', auth: authClient });

    // Cari folder eksisting
    const query = `mimeType='application/vnd.google-apps.folder' and name='${this.folderName}' and trashed=false`;
    const res = await drive.files.list({
      q: query,
      fields: 'files(id, name)',
      spaces: 'drive',
    });

    if (res.data.files && res.data.files.length > 0) {
      return res.data.files[0].id!;
    }

    // Jika belum ada, buat folder baru
    const folderMetadata = {
      name: this.folderName,
      mimeType: 'application/vnd.google-apps.folder',
    };

    const folder = await drive.files.create({
      requestBody: folderMetadata,
      fields: 'id',
    });

    return folder.data.id!;
  }

  /**
   * Upload file backup .sql.gz ke Google Drive
   */
  public async uploadBackupFile(
    authClient: any,
    filePath: string,
    fileName: string,
    folderId: string
  ): Promise<DriveBackupFile> {
    const drive = google.drive({ version: 'v3', auth: authClient });

    const fileMetadata = {
      name: fileName,
      parents: [folderId],
    };

    const media = {
      mimeType: 'application/gzip',
      body: fs.createReadStream(filePath),
    };

    const response = await drive.files.create({
      requestBody: fileMetadata,
      media,
      fields: 'id, name, size, createdTime, webViewLink',
    });

    const file = response.data;
    return {
      id: file.id || '',
      name: file.name || fileName,
      sizeBytes: file.size ? parseInt(file.size, 10) : fs.statSync(filePath).size,
      createdTime: file.createdTime ? new Date(file.createdTime) : new Date(),
      webViewLink: file.webViewLink || undefined,
    };
  }

  /**
   * Mengambil daftar file backup yang ada di Google Drive
   */
  public async listBackups(authClient: any, folderId: string): Promise<DriveBackupFile[]> {
    const drive = google.drive({ version: 'v3', auth: authClient });

    const query = `'${folderId}' in parents and trashed=false`;
    const response = await drive.files.list({
      q: query,
      orderBy: 'createdTime desc',
      fields: 'files(id, name, size, createdTime, webViewLink)',
      pageSize: 50,
    });

    const files = response.data.files || [];
    return files.map((f) => ({
      id: f.id || '',
      name: f.name || '',
      sizeBytes: f.size ? parseInt(f.size, 10) : 0,
      createdTime: f.createdTime ? new Date(f.createdTime) : new Date(),
      webViewLink: f.webViewLink || undefined,
    }));
  }

  /**
   * Hapus file backup yang lebih tua dari retensi (default simpan 8 backup mingguan terakhir)
   */
  public async pruneOldBackups(
    authClient: any,
    folderId: string,
    keepCount = 8
  ): Promise<number> {
    const backups = await this.listBackups(authClient, folderId);
    if (backups.length <= keepCount) {
      return 0;
    }

    const drive = google.drive({ version: 'v3', auth: authClient });
    const toDelete = backups.slice(keepCount);
    let deletedCount = 0;

    for (const file of toDelete) {
      try {
        await drive.files.delete({ fileId: file.id });
        deletedCount++;
        console.log(`[GoogleDriveBackup] Pruned old backup file: ${file.name} (${file.id})`);
      } catch (err: any) {
        console.warn(`[GoogleDriveBackup] Gagal menghapus backup lama ${file.name}:`, err?.message);
      }
    }

    return deletedCount;
  }
}

export const googleDriveBackupClient = new GoogleDriveBackupClient();
