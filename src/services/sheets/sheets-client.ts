import { google } from 'googleapis';
import { googleOAuthClientManager } from '../../integrations/google-contacts/google-oauth.client';

/**
 * sheets-client.ts — Adaptor tipis di atas Google Sheets API v4 memakai token
 * OAuth per-tenant yang SUDAH tersimpan (bukan Service Account terpisah, bukan
 * `WahaClient`). Semua detail googleapis disembunyikan di balik interface
 * `SheetsGateway` agar service sinkronisasi dapat diuji offline (inject fake).
 *
 * Prinsip fondasional:
 * - Least-privilege: cukup scope `spreadsheets` (tanpa `drive`) untuk Fase 2.
 * - Race-safe: pembuatan tab menangkap error "sudah ada" dari Google lalu
 *   re-fetch → bukan meledak.
 * - Write-once harga: `updateCells` menulis HANYA kolom yang diberikan, sehingga
 *   koreksi manual admin pada kolom harga (I/J/K) tidak pernah tertimpa.
 * - Tanpa dependency baru (`googleapis` sudah ada).
 */

export interface EnsureMonthlyTabParams {
  tenantId: string;
  spreadsheetId: string;
  tabName: string;
  templateSheetName: string;
}

export interface EnsureMonthlyTabResult {
  /** Nama tab sebenarnya di file (case dari file, bukan dari config). */
  tabName: string;
  created: boolean;
}

export interface AppendRowParams {
  tenantId: string;
  spreadsheetId: string;
  tabName: string;
  row: (string | number)[];
}

export interface AppendRowResult {
  /** Nomor baris 1-based setelah append (untuk disimpan di DB). */
  rowIndex: number;
}

export interface UpdateCellsParams {
  tenantId: string;
  spreadsheetId: string;
  tabName: string;
  /** Baris 1-based di sheet (header = 1). */
  rowIndex: number;
  /** Sel yang ditulis: { col: nomor kolom 1-based, value }. */
  cells: Array<{ col: number; value: string | number }>;
}

/** Seam uji: implementasi default menembak Google; test memakai fake. */
export interface SheetsGateway {
  ensureMonthlyTab(params: EnsureMonthlyTabParams): Promise<EnsureMonthlyTabResult>;
  appendRow(params: AppendRowParams): Promise<AppendRowResult>;
  updateCells(params: UpdateCellsParams): Promise<void>;
}

export const SHEETS_NOT_CONNECTED = 'SHEETS_NOT_CONNECTED';
export const TEMPLATE_SHEET_NOT_FOUND = 'TEMPLATE_SHEET_NOT_FOUND';

/**
 * Ambil nomor baris dari `updatedRange` Google, mis. "okt!A5:P5" → 5.
 * Murni & defensif: format tak dikenal → lempar agar tidak menyimpan nomor salah.
 */
export function parseRowIndexFromRange(updatedRange: string | null | undefined): number {
  const m = String(updatedRange || '').match(/![A-Z]+(\d+)/);
  if (!m) throw new Error('UNPARSEABLE_UPDATED_RANGE');
  const n = parseInt(m[1], 10);
  if (!Number.isFinite(n) || n < 1) throw new Error('UNPARSEABLE_UPDATED_RANGE');
  return n;
}

/** Angka kolom 1-based → huruf (1 → A, 16 → P). */
export function columnLetter(count: number): string {
  let n = count;
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export class GoogleSheetsGateway implements SheetsGateway {
  private async getSheets(tenantId: string): Promise<any> {
    const auth = await googleOAuthClientManager.getAuthenticatedClient(tenantId);
    if (!auth) throw new Error(SHEETS_NOT_CONNECTED);
    return google.sheets({ version: 'v4', auth });
  }

  public async ensureMonthlyTab(params: EnsureMonthlyTabParams): Promise<EnsureMonthlyTabResult> {
    const { tenantId, spreadsheetId, tabName, templateSheetName } = params;
    const sheets = await this.getSheets(tenantId);
    const wanted = tabName.trim().toLowerCase();

    const readSheets = async (): Promise<any[]> => {
      const meta = await sheets.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets(properties(sheetId,title))',
      });
      return meta.data.sheets || [];
    };

    let list = await readSheets();
    const found = list.find((s: any) => (s.properties?.title || '').trim().toLowerCase() === wanted);
    if (found) return { tabName: found.properties.title, created: false };

    const template = list.find(
      (s: any) => (s.properties?.title || '').trim().toLowerCase() === templateSheetName.trim().toLowerCase()
    );
    if (template?.properties?.sheetId == null) {
      throw new Error(TEMPLATE_SHEET_NOT_FOUND);
    }

    try {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              duplicateSheet: {
                sourceSheetId: template.properties.sheetId,
                newSheetName: tabName,
                insertSheetIndex: list.length,
              },
            },
          ],
        },
      });
    } catch (err: any) {
      // Balapan (dua worker buat tab bareng): Google menolak nama duplikat.
      // Re-fetch; bila sudah ada → anggap sukses (idempoten), bukan gagal.
      list = await readSheets();
      const after = list.find((s: any) => (s.properties?.title || '').trim().toLowerCase() === wanted);
      if (after) return { tabName: after.properties.title, created: false };
      throw err;
    }

    // Bersihkan baris data lama, pertahankan header (baris 1), warna, rumus,
    // dan dropdown Bidan pada tab hasil duplikasi template.
    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: `${tabName}!A2:P1000`,
    });

    return { tabName, created: true };
  }

  public async appendRow(params: AppendRowParams): Promise<AppendRowResult> {
    const { tenantId, spreadsheetId, tabName, row } = params;
    const sheets = await this.getSheets(tenantId);
    const res = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${tabName}!A1`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [row] },
    });
    const updatedRange: string | undefined = res?.data?.updates?.updatedRange;
    return { rowIndex: parseRowIndexFromRange(updatedRange) };
  }

  public async updateCells(params: UpdateCellsParams): Promise<void> {
    const { tenantId, spreadsheetId, tabName, rowIndex, cells } = params;
    if (!cells || cells.length === 0) return;
    const sheets = await this.getSheets(tenantId);
    // Kelompokkan kolom berurutan menjadi range agar hemat panggilan API.
    const sorted = [...cells].sort((a, b) => a.col - b.col);
    let start = sorted[0].col;
    let prev = sorted[0].col;
    let group: (string | number)[] = [sorted[0].value];
    const flush = async (): Promise<void> => {
      const range = `${tabName}!${columnLetter(start)}${rowIndex}:${columnLetter(prev)}${rowIndex}`;
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [group] },
      });
    };
    for (let i = 1; i < sorted.length; i++) {
      const c = sorted[i];
      if (c.col === prev + 1) {
        group.push(c.value);
        prev = c.col;
      } else {
        await flush();
        start = c.col;
        prev = c.col;
        group = [c.value];
      }
    }
    await flush();
  }
}

export const googleSheetsGateway = new GoogleSheetsGateway();
