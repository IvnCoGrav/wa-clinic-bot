import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { ROOT_DIR, toAbsolute, toRelative, exists, listFiles } from './paths.mjs';

/**
 * Membaca file registry JSON.
 * @param {string} [registryPath='scripts/module-registry.json']
 * @returns {any}
 */
export function loadRegistry(registryPath = 'scripts/module-registry.json') {
  const fullPath = toAbsolute(registryPath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`File registry tidak ditemukan: ${registryPath}`);
  }
  const content = fs.readFileSync(fullPath, 'utf8');
  return JSON.parse(content);
}

/**
 * Mendapatkan daftar nama export dari file TypeScript menggunakan AST.
 * @param {string} filePathRelOrAbs
 * @returns {string[]}
 */
export function getActualExports(filePathRelOrAbs) {
  const fullPath = toAbsolute(filePathRelOrAbs);
  if (!fs.existsSync(fullPath)) return [];

  const sourceText = fs.readFileSync(fullPath, 'utf8');
  const sourceFile = ts.createSourceFile(fullPath, sourceText, ts.ScriptTarget.Latest, true);
  const exports = new Set();

  function visit(node) {
    // 1. Export modifier pada function, class, enum, interface, type, variable
    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
    const isExported = modifiers && modifiers.some(m => m.kind === ts.SyntaxKind.ExportKeyword);

    if (isExported) {
      if (ts.isFunctionDeclaration(node) && node.name) {
        exports.add(node.name.text);
      } else if (ts.isClassDeclaration(node) && node.name) {
        exports.add(node.name.text);
      } else if (ts.isEnumDeclaration(node) && node.name) {
        exports.add(node.name.text);
      } else if (ts.isInterfaceDeclaration(node) && node.name) {
        exports.add(node.name.text);
      } else if (ts.isTypeAliasDeclaration(node) && node.name) {
        exports.add(node.name.text);
      } else if (ts.isVariableStatement(node)) {
        node.declarationList.declarations.forEach(decl => {
          if (decl.name && ts.isIdentifier(decl.name)) {
            exports.add(decl.name.text);
          }
        });
      }
    }

    // 2. Export declaration: export { a, b as c } atau export { x } from './y'
    if (ts.isExportDeclaration(node)) {
      if (node.exportClause && ts.isNamedExports(node.exportClause)) {
        node.exportClause.elements.forEach(el => {
          exports.add(el.name.text);
        });
      }
    }

    // 3. Export default
    if (ts.isExportAssignment(node)) {
      exports.add('default');
    }

    ts.forEachChild(node, visit);
  }

  ts.forEachChild(sourceFile, visit);
  return Array.from(exports);
}

/**
 * Validasi kepatuhan skema dan fakta fisik registry modul.
 * @param {any} registry
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateRegistry(registry) {
  const errors = [];

  if (!registry || typeof registry !== 'object') {
    return { valid: false, errors: ['Registry harus berupa JSON object'] };
  }

  if (typeof registry.version !== 'number' || registry.version < 1) {
    errors.push('Field "version" harus berupa angka >= 1');
  }

  if (!Array.isArray(registry.capabilities)) {
    return { valid: false, errors: ['Field "capabilities" harus berupa array'] };
  }

  const seenIds = new Set();
  const seenCanonicals = new Set();

  for (const [idx, cap] of registry.capabilities.entries()) {
    const loc = `capabilities[${idx}] (id: ${cap.id || 'tanpa id'})`;

    // 1. Validasi ID
    if (!cap.id || typeof cap.id !== 'string') {
      errors.push(`${loc}: Field "id" harus berupa string non-kosong`);
    } else {
      if (!/^[a-z0-9_]+\.[a-z0-9_]+$/.test(cap.id)) {
        errors.push(`${loc}: Format id "${cap.id}" tidak valid. Harus format "domain.kapabilitas" (contoh: "pii.mask_phone")`);
      }
      if (seenIds.has(cap.id)) {
        errors.push(`${loc}: ID duplikat terdeteksi: "${cap.id}"`);
      }
      seenIds.add(cap.id);
    }

    // 2. Validasi Title & Description
    if (!cap.title || typeof cap.title !== 'string') {
      errors.push(`${loc}: Field "title" harus berupa string non-kosong`);
    }
    if (!cap.description || typeof cap.description !== 'string') {
      errors.push(`${loc}: Field "description" harus berupa string non-kosong`);
    }

    // 3. Validasi Canonical File
    if (!cap.canonical || typeof cap.canonical !== 'string') {
      errors.push(`${loc}: Field "canonical" harus berupa path file string`);
    } else {
      const canonicalPath = toRelative(cap.canonical);
      if (!exists(canonicalPath)) {
        errors.push(`${loc}: File kanonis "${canonicalPath}" tidak ditemukan di disk`);
      } else {
        if (seenCanonicals.has(canonicalPath)) {
          errors.push(`${loc}: File kanonis ganda terdaftar: "${canonicalPath}"`);
        }
        seenCanonicals.add(canonicalPath);

        // 4. Validasi Exports terhadap file kanonis aktual
        if (!Array.isArray(cap.exports) || cap.exports.length === 0) {
          errors.push(`${loc}: Field "exports" harus berupa array string non-kosong`);
        } else {
          const actualExports = getActualExports(canonicalPath);
          for (const exp of cap.exports) {
            if (!actualExports.includes(exp)) {
              errors.push(`${loc}: Export "${exp}" tidak ditemukan di file kanonis "${canonicalPath}"`);
            }
          }
        }
      }
    }

    // 5. Validasi Test (opsional, jika diisi harus ada)
    if (cap.test !== null && cap.test !== undefined) {
      if (typeof cap.test !== 'string' || cap.test.trim() === '') {
        errors.push(`${loc}: Field "test" jika diisi harus berupa path file string non-kosong atau null`);
      } else if (!exists(cap.test)) {
        errors.push(`${loc}: File test "${cap.test}" tidak ditemukan di disk`);
      }
    }

    // 6. Validasi AllowedFiles
    if (!Array.isArray(cap.allowedFiles)) {
      errors.push(`${loc}: Field "allowedFiles" harus berupa array string`);
    } else {
      for (const af of cap.allowedFiles) {
        if (!exists(af)) {
          errors.push(`${loc}: File allowed "${af}" tidak ditemukan di disk`);
        }
      }
    }

    // 7. Validasi ForbiddenDeclarations
    if (!Array.isArray(cap.forbiddenDeclarations)) {
      errors.push(`${loc}: Field "forbiddenDeclarations" harus berupa array string`);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Mencari kapabilitas di registry berdasarkan kata kunci query.
 * @param {any} registry
 * @param {string} query
 * @param {number} [limit=5]
 * @returns {Array<{ capability: any, score: number, matchedBy: string[] }>}
 */
export function searchCapabilities(registry, query, limit = 5) {
  if (!query || typeof query !== 'string' || query.trim() === '') {
    return [];
  }

  const rawQuery = query.toLowerCase().trim();
  const queryTokens = rawQuery.split(/[\s,._-]+/).filter(t => t.length > 1);

  const results = [];

  for (const cap of registry.capabilities) {
    let score = 0;
    const matchedBy = [];

    const idLower = cap.id.toLowerCase();
    const titleLower = cap.title.toLowerCase();
    const descLower = cap.description.toLowerCase();
    const canonicalLower = cap.canonical.toLowerCase();
    const canonicalBase = path.basename(cap.canonical, path.extname(cap.canonical)).toLowerCase();
    const exportsLower = cap.exports.map(e => e.toLowerCase());

    // 1. Cocok eksak ID atau query ada di ID
    if (idLower === rawQuery) {
      score += 120;
      matchedBy.push('exact id');
    } else if (idLower.includes(rawQuery)) {
      score += 70;
      matchedBy.push('substring id');
    }

    // 2. Cocok eksak nama export
    if (exportsLower.includes(rawQuery)) {
      score += 100;
      matchedBy.push('exact export');
    }

    // 3. Cocok nama file kanonis
    if (canonicalBase === rawQuery || canonicalLower.includes(rawQuery)) {
      score += 60;
      matchedBy.push('canonical filename');
    }

    // 4. Token-level matching
    for (const token of queryTokens) {
      if (idLower.includes(token)) {
        score += 35;
        matchedBy.push(`id contains "${token}"`);
      }
      if (canonicalBase.includes(token)) {
        score += 30;
        matchedBy.push(`file contains "${token}"`);
      }
      if (titleLower.includes(token)) {
        score += 25;
        matchedBy.push(`title contains "${token}"`);
      }
      if (exportsLower.some(e => e.includes(token))) {
        score += 25;
        matchedBy.push(`export contains "${token}"`);
      }
      if (descLower.includes(token)) {
        score += 15;
        matchedBy.push(`desc contains "${token}"`);
      }
    }

    // 5. Frasa lengkap pada judul atau deskripsi
    if (titleLower.includes(rawQuery)) {
      score += 40;
      matchedBy.push('title phrase');
    }
    if (descLower.includes(rawQuery)) {
      score += 30;
      matchedBy.push('description phrase');
    }

    if (score > 0) {
      results.push({
        capability: cap,
        score,
        matchedBy: Array.from(new Set(matchedBy))
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

/**
 * Menghitung berapa banyak file di `src/` yang mengimpor modul kanonis ini.
 * @param {string} canonicalRelPath
 * @returns {number}
 */
export function countUsages(canonicalRelPath) {
  const normCanonical = toRelative(canonicalRelPath);
  const baseName = path.basename(normCanonical, path.extname(normCanonical));
  const srcFiles = listFiles('src', { extensions: ['.ts'] });

  let count = 0;
  for (const file of srcFiles) {
    if (file === normCanonical) continue;
    try {
      const content = fs.readFileSync(toAbsolute(file), 'utf8');
      // Cocokkan import dari path file ini
      if (content.includes(baseName)) {
        // Verifikasi apakah benar-benar baris import
        const hasImport = new RegExp(`from\\s+['"][^'"]*${baseName}['"]|import\\s*\\(['"][^'"]*${baseName}['"]\\)`).test(content);
        if (hasImport) count++;
      }
    } catch {
      // Abaikan bila file terkunci/gagal dibaca
    }
  }
  return count;
}

/**
 * Menghasilkan isi file docs/MODULE_INDEX.md secara deterministik.
 * @param {any} registry
 * @returns {string}
 */
export function generateModuleIndexMarkdown(registry) {
  // Sort capabilities deterministik berdasarkan ID
  const sorted = [...registry.capabilities].sort((a, b) => a.id.localeCompare(b.id));

  let md = `# Modul Kanonis & Registry Reuse\n\n`;
  md += `> **PERINGATAN — FILE INI DIBUAT OTOMATIS.**\n`;
  md += `> Jangan edit file ini secara manual. Sumber kebenaran adalah \`scripts/module-registry.json\`.\n`;
  md += `> Untuk memperbarui dokumen ini, jalankan: \`npm run docs:modules\`.\n`;
  md += `> Untuk mencari modul dari CLI sebelum membuat kode baru, jalankan: \`npm run find:module -- "<kebutuhan>"\`.\n\n`;
  md += `## 1. Daftar Kapabilitas Kanonis Aktif\n\n`;
  md += `Total kapabilitas terdaftar: **${sorted.length} modul**.\n\n`;

  md += `| ID Kapabilitas | Judul & Deskripsi | Modul Kanonis | Ekspor Resmi | Test File |\n`;
  md += `|---|---|---|---|---|\n`;

  for (const cap of sorted) {
    const exportsList = cap.exports.map(e => `\`${e}\``).join(', ');
    const testDisplay = cap.test ? `[\`${path.basename(cap.test)}\`](../${cap.test})` : '*Belum ada (Fase lanjutan)*';
    md += `| \`${cap.id}\` | **${cap.title}**<br>${cap.description} | [\`${cap.canonical}\`](../${cap.canonical}) | ${exportsList} | ${testDisplay} |\n`;
  }

  md += `\n## 2. Rincian Modul & Aturan Guardrail\n\n`;

  for (const cap of sorted) {
    md += `### \`${cap.id}\` — ${cap.title}\n\n`;
    md += `- **Deskripsi:** ${cap.description}\n`;
    md += `- **File Kanonis:** [\`${cap.canonical}\`](../${cap.canonical})\n`;
    md += `- **Ekspor Kanonis:** ${cap.exports.map(e => `\`${e}\``).join(', ')}\n`;
    md += `- **Simbol Terlarang di Luar Kanonis:** ${cap.forbiddenDeclarations.map(s => `\`${s}\``).join(', ')}\n`;
    md += `- **File yang Diizinkan:** ${cap.allowedFiles.map(f => `\`${f}\``).join(', ')}\n`;
    md += `- **File Test:** ${cap.test ? `[\`${cap.test}\`](../${cap.test})` : '*Belum didefinisikan*'}\n\n`;
  }

  md += `---\n\n`;
  md += `## 3. Cara Menambah atau Mengubah Modul Kanonis\n\n`;
  md += `1. Pastikan kapabilitas baru benar-benar bersifat fondasional dan dipakai lintas modul.\n`;
  md += `2. Daftarkan entri baru di \`scripts/module-registry.json\`.\n`;
  md += `3. Jalankan \`npm run docs:modules\` untuk memperbarui dokumen ini.\n`;
  md += `4. Jalankan \`npx vitest run tests/unit/module-registry.test.ts\` untuk memastikan kepatuhan skema dan fakta disk.\n`;

  return md;
}
