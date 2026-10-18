import fs from 'fs';
import path from 'path';

// CLI argument parsing
const args = process.argv.slice(2);
const isWrite = args.includes('--write');
const sourcesArgIdx = args.findIndex(a => a.startsWith('--sources=') || a === '--sources');
let sourcePatterns = ['CHANGELOG.md', 'docs/changelog/archive-*.md'];

if (sourcesArgIdx !== -1) {
  const val = args[sourcesArgIdx].startsWith('--sources=')
    ? args[sourcesArgIdx].split('=')[1]
    : args[sourcesArgIdx + 1];
  if (val) {
    sourcePatterns = val.split(',').map(s => s.trim()).filter(Boolean);
  }
}

// Expand source patterns (e.g., support docs/changelog/archive-*.md)
function resolveSources(patterns) {
  const resolved = [];
  for (const pat of patterns) {
    if (pat.includes('*')) {
      const dir = path.dirname(pat);
      const basePattern = path.basename(pat).replace(/\*/g, '.*');
      const regex = new RegExp(`^${basePattern}$`);
      if (fs.existsSync(dir)) {
        const files = fs.readdirSync(dir)
          .filter(f => regex.test(f))
          .sort()
          .reverse(); // descending order (e.g., 2026-09 before 2026-08)
        for (const f of files) {
          resolved.push(path.join(dir, f));
        }
      }
    } else {
      if (fs.existsSync(pat)) {
        resolved.push(pat);
      }
    }
  }
  return resolved;
}

const sourceFiles = resolveSources(sourcePatterns);
if (sourceFiles.length === 0) {
  console.error('Error: No source files found for patterns:', sourcePatterns);
  process.exit(1);
}

const HEADING_REGEX = /^(#### |### |## \[)/;
const allBlocks = [];
let lastDate = 'UNKNOWN';

for (const filePath of sourceFiles) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (HEADING_REGEX.test(line)) {
      const raw = line.replace(/^(#### |### |## )/, '').trim();
      const dateMatch = raw.match(/20\d{2}-\d{2}-\d{2}/);
      let date = null;
      if (dateMatch) {
        date = dateMatch[0];
        lastDate = date;
      } else {
        date = lastDate;
      }

      const clean = raw.replace(/^20\d{2}-\d{2}-\d{2}\s*[-—:]\s*/, '').trim();
      const title = clean.length > 90 ? clean.slice(0, 90).trim() : clean;

      allBlocks.push({
        source: filePath,
        line: i + 1,
        date,
        title,
        rawHeading: line
      });
    }
  }
}

const blocksCount = allBlocks.length;
const indexedCount = allBlocks.filter(b => b.date && b.title).length;
const missingCount = blocksCount - indexedCount;

console.log(`blocks=${blocksCount} indexed=${indexedCount} missing=${missingCount}`);

if (isWrite) {
  const outDir = path.resolve('docs/changelog');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const indexLines = [
    '# CHANGELOG INDEX',
    '',
    '> **Catatan Operasional**:',
    '> Kunci pencarian = judul entri via `rg "<judul>" CHANGELOG.md` (atau file arsip di `docs/changelog/archive-*.md`).',
    '> Dilarang menyerap seluruh file sejarah 1,1 MB ke context window LLM.',
    '> Regenerate ulang index setiap entri baru: `node scripts/make-changelog-index.mjs --write`.',
    '',
    `Total entri terindeks: ${indexedCount}`,
    ''
  ];

  for (const block of allBlocks) {
    indexLines.push(`- ${block.date} | ${block.title}`);
  }
  indexLines.push(''); // trailing newline

  const outPath = path.join(outDir, 'INDEX.md');
  fs.writeFileSync(outPath, indexLines.join('\n'), 'utf8');
  console.log(`Written ${indexedCount} entries to ${outPath}`);
} else {
  console.log('Dry-run completed. Run with --write to generate docs/changelog/INDEX.md');
}
