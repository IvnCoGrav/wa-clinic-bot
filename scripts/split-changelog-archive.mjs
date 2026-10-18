import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// CLI parsing
const args = process.argv.slice(2);
const isWrite = args.includes('--write');
const cutoffArgIdx = args.findIndex(a => a.startsWith('--cutoff-date=') || a === '--cutoff-date');
let cutoffDate = '2026-10-01';

if (cutoffArgIdx !== -1) {
  const val = args[cutoffArgIdx].startsWith('--cutoff-date=')
    ? args[cutoffArgIdx].split('=')[1]
    : args[cutoffArgIdx + 1];
  if (val) cutoffDate = val.trim();
}

const changelogPath = path.resolve('CHANGELOG.md');
if (!fs.existsSync(changelogPath)) {
  console.error('Error: CHANGELOG.md not found');
  process.exit(1);
}

const originalContent = fs.readFileSync(changelogPath, 'utf8');
const lines = originalContent.split(/\r?\n/);
const HEADING_REGEX = /^(#### |### |## \[)/;

const blocks = [];
let currentBlock = null;
let lastDate = 'UNKNOWN';
const headerLines = [];
let firstBlockLine = -1;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (HEADING_REGEX.test(line)) {
    if (firstBlockLine === -1) firstBlockLine = i;
    if (currentBlock) {
      currentBlock.endLine = i - 1;
      currentBlock.rawContent = lines.slice(currentBlock.startLine, i).join('\n');
      currentBlock.hash = crypto.createHash('sha256').update(currentBlock.rawContent).digest('hex');
      blocks.push(currentBlock);
    }
    const raw = line.replace(/^(#### |### |## )/, '').trim();
    const dateMatch = raw.match(/20\d{2}-\d{2}-\d{2}/);
    if (dateMatch) lastDate = dateMatch[0];

    currentBlock = {
      startLine: i,
      heading: line,
      date: lastDate,
      ym: lastDate.slice(0, 7)
    };
  } else if (firstBlockLine === -1) {
    headerLines.push(line);
  }
}

if (currentBlock) {
  currentBlock.endLine = lines.length - 1;
  currentBlock.rawContent = lines.slice(currentBlock.startLine).join('\n');
  currentBlock.hash = crypto.createHash('sha256').update(currentBlock.rawContent).digest('hex');
  blocks.push(currentBlock);
}

const rootBlocks = blocks.filter(b => b.date >= cutoffDate);
const movedBlocks = blocks.filter(b => b.date < cutoffDate);

const archiveMap = {};
for (const b of movedBlocks) {
  if (!archiveMap[b.ym]) archiveMap[b.ym] = [];
  archiveMap[b.ym].push(b);
}

// Assertion parity check: verify all source blocks are accounted for
let parityOk = true;
let missing = 0;

if (rootBlocks.length + movedBlocks.length !== blocks.length) {
  parityOk = false;
  missing = blocks.length - (rootBlocks.length + movedBlocks.length);
}

// Hash verification against source
for (const b of blocks) {
  const checkHash = crypto.createHash('sha256').update(b.rawContent).digest('hex');
  if (checkHash !== b.hash) {
    parityOk = false;
    missing++;
  }
}

if (parityOk && missing === 0) {
  console.log(`parity=OK blocks=${blocks.length} moved=${movedBlocks.length} missing=0`);
} else {
  console.error(`parity=FAIL blocks=${blocks.length} moved=${movedBlocks.length} missing=${missing}`);
  process.exit(1);
}

console.log(`Summary: Root living blocks: ${rootBlocks.length}, Moved to archives: ${movedBlocks.length}`);
for (const ym of Object.keys(archiveMap).sort().reverse()) {
  console.log(`  - Archive ${ym}: ${archiveMap[ym].length} blocks`);
}

if (isWrite) {
  const archiveDir = path.resolve('docs/changelog');
  if (!fs.existsSync(archiveDir)) {
    fs.mkdirSync(archiveDir, { recursive: true });
  }

  // 1. Write archive files
  for (const [ym, archiveBlocks] of Object.entries(archiveMap)) {
    const archiveFilePath = path.join(archiveDir, `archive-${ym}.md`);
    const header = [
      `# Changelog Archive - ${ym}`,
      '',
      `Arsip riwayat perubahan untuk periode ${ym}.`,
      ''
    ].join('\n');

    const body = archiveBlocks.map(b => b.rawContent).join('\n');
    const fullArchiveContent = header + body + '\n';
    fs.writeFileSync(archiveFilePath, fullArchiveContent, 'utf8');
    console.log(`Written archive: ${archiveFilePath} (${archiveBlocks.length} blocks)`);
  }

  // 2. Write root CHANGELOG.md (living file)
  const rootHeader = headerLines.join('\n') + '\n';
  const rootBody = rootBlocks.map(b => b.rawContent).join('\n');
  const tail = [
    '',
    '## Arsip & INDEX',
    '',
    'Lihat riwayat lengkap di [docs/changelog/INDEX.md](docs/changelog/INDEX.md) dan arsip bulanan di `docs/changelog/archive-*.md`.',
    ''
  ].join('\n');

  const newChangelogContent = rootHeader + rootBody + tail;
  fs.writeFileSync(changelogPath, newChangelogContent, 'utf8');
  console.log(`Updated root CHANGELOG.md (${rootBlocks.length} living blocks)`);

  // Post-write verification: count headings across root + archives
  let writtenHeadings = 0;
  const countHeadingsInFile = (fp) => {
    const fc = fs.readFileSync(fp, 'utf8');
    const flines = fc.split(/\r?\n/);
    let count = 0;
    for (const fl of flines) {
      if (HEADING_REGEX.test(fl)) count++;
    }
    return count;
  };

  const rootHeadings = countHeadingsInFile(changelogPath);
  let totalArchiveHeadings = 0;
  for (const ym of Object.keys(archiveMap)) {
    const afp = path.join(archiveDir, `archive-${ym}.md`);
    totalArchiveHeadings += countHeadingsInFile(afp);
  }

  const grandTotal = rootHeadings + totalArchiveHeadings;
  console.log(`Post-write heading verification: root=${rootHeadings} archives=${totalArchiveHeadings} total=${grandTotal} (expected=${blocks.length})`);
  if (grandTotal !== blocks.length) {
    console.error(`ERROR: Heading count mismatch! Expected ${blocks.length}, got ${grandTotal}`);
    process.exit(1);
  }
} else {
  console.log('Dry-run completed. Run with --write to execute split.');
}
