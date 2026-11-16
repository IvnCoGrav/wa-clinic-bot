import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DASHBOARD_ROOT = path.resolve(__dirname, '..');

function listTsx(dirRel, ext = ['.tsx']) {
  const dirAbs = path.join(DASHBOARD_ROOT, dirRel);
  if (!fs.existsSync(dirAbs)) return [];
  const entries = fs.readdirSync(dirAbs, { withFileTypes: true, recursive: true });
  return entries
    .filter(e => e.isFile() && ext.some(x => e.name.endsWith(x)))
    .map(e => {
      const fullPath = path.join(e.parentPath || dirAbs, e.name);
      return path.relative(DASHBOARD_ROOT, fullPath).replace(/\\/g, '/');
    })
    .sort();
}

const uiFiles = listTsx('src/components/ui', ['.tsx']);
const commonFiles = listTsx('src/components/common', ['.tsx']);
const pageFiles = listTsx('src/pages', ['.tsx']);

const components = [
  ...uiFiles.map(f => {
    const base = path.basename(f, path.extname(f));
    return {
      name: base,
      layer: 'primitive',
      path: f,
      whenToUse: `Primitif antarmuka dasar ${base}. Gunakan prop variant/props yang tersedia.`,
      states: ['default', 'hover', 'disabled', 'loading'],
      reviewed: false
    };
  }),
  ...commonFiles.map(f => {
    const base = path.basename(f, path.extname(f));
    return {
      name: base,
      layer: 'pattern',
      path: f,
      whenToUse: `Pattern komponen bersama ${base}. Gunakan kembali sebelum membuat implementasi baru.`,
      states: ['default'],
      reviewed: false
    };
  })
];

const pages = pageFiles.map(f => {
  const parts = f.split('/');
  const sub = parts.length > 2 ? parts[2] : 'root';
  if (f === 'src/pages/UiCatalog.tsx') {
    return {
      path: f,
      module: 'dev-tools',
      parent: null,
      adr: 'ADR-0004',
      reviewed: true
    };
  }
  return {
    path: f,
    module: sub,
    parent: null,
    adr: null,
    reviewed: false
  };
});

const registry = {
  version: 1,
  layers: {
    primitive: 'src/components/ui',
    pattern: 'src/components/common',
    domain: 'src/components',
    page: 'src/pages'
  },
  components,
  pages,
  allow: {
    rawFetch: [
      { file: 'src/components/copilot/AdminCopilotPanel.tsx', reason: 'SSE stream' },
      { file: 'src/components/customer/CustomerMapTab.tsx', reason: 'GeoJSON statis' },
      { file: 'src/pages/tenant/TodayTreatments.tsx', reason: 'Nominatim eksternal' },
      { file: 'src/components/common/VoiceNotePlayer.tsx', reason: 'Audio blob fetch' },
      { file: 'src/pages/tenant/CustomerDatabase.tsx', reason: 'Audience export blob download' },
      { file: 'src/pages/tenant/FinancialAnalytics.tsx', reason: 'Financial report blob download' },
      { file: 'src/pages/tenant/KnowledgeBase.tsx', reason: 'Markdown/raw file export blob download' },
      { file: 'src/utils/geoUtils.ts', reason: 'Nominatim/ORS reverse geocode fetch' }
    ]
  }
};

const outPath = path.join(DASHBOARD_ROOT, 'src/ui-registry.json');
fs.writeFileSync(outPath, JSON.stringify(registry, null, 2) + '\n', 'utf8');
console.log(`[UI REGISTRY] Generated ${components.length} components, ${pages.length} pages to ${outPath}`);
