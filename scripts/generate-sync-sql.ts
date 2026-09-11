import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

interface ServiceItem {
  id: string;
  name: string;
  category: string;
  serviceType?: string;
  bundleItemIds?: string[];
  isAddon?: boolean;
  ageTier: {
    minAgeMonths: number;
    maxAgeMonths: number | null;
    label: string;
  };
  durationMinutes: number;
  originalPrice: number;
  promoPrice: number;
  description: string;
  isActive: boolean;
  totalSessions?: number;
  sessionScheduleType?: string;
}

const servicesPath = path.join(__dirname, '..', 'services_custom.json');
const services: ServiceItem[] = JSON.parse(fs.readFileSync(servicesPath, 'utf8'));

console.log(`Loaded ${services.length} services from services_custom.json`);

const tenantId = 'default-tenant';
const sqlStatements: string[] = ['BEGIN;'];

services.forEach((s, idx) => {
  let metaDesc = s.description;
  if (s.bundleItemIds && s.bundleItemIds.length > 0 && !metaDesc.includes('[BUNDLE:')) {
    metaDesc = `[BUNDLE:${s.bundleItemIds.join(',')}] ${metaDesc}`;
  }
  if (s.isAddon && !metaDesc.includes('[ADDON]')) {
    metaDesc = `[ADDON] ${metaDesc}`;
  }

  const escapeStr = (str: string) => "'" + str.replace(/'/g, "''") + "'";
  const escapeNullableInt = (val: number | null | undefined) => (val === null || val === undefined ? 'NULL' : Math.round(val));
  const escapeNullableStr = (val: string | null | undefined) => (val === null || val === undefined ? 'NULL' : escapeStr(val));

  const sql = `
INSERT INTO clinic_services (
  id, tenant_id, service_id, name, category, min_age_months, max_age_months,
  age_label, duration_minutes, original_price, promo_price, description,
  is_active, sort_order, total_sessions, session_schedule_type, created_at, updated_at
) VALUES (
  gen_random_uuid()::text,
  ${escapeStr(tenantId)},
  ${escapeStr(s.id)},
  ${escapeStr(s.name)},
  ${escapeStr(s.category)},
  ${Math.round(s.ageTier.minAgeMonths)},
  ${escapeNullableInt(s.ageTier.maxAgeMonths)},
  ${escapeStr(s.ageTier.label)},
  ${s.durationMinutes},
  ${s.originalPrice},
  ${s.promoPrice},
  ${escapeStr(metaDesc)},
  ${s.isActive ? 'TRUE' : 'FALSE'},
  ${idx + 1},
  ${escapeNullableInt(s.totalSessions)},
  ${escapeNullableStr(s.sessionScheduleType)},
  NOW(),
  NOW()
)
ON CONFLICT (tenant_id, service_id) DO UPDATE SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  min_age_months = EXCLUDED.min_age_months,
  max_age_months = EXCLUDED.max_age_months,
  age_label = EXCLUDED.age_label,
  duration_minutes = EXCLUDED.duration_minutes,
  original_price = EXCLUDED.original_price,
  promo_price = EXCLUDED.promo_price,
  description = EXCLUDED.description,
  is_active = EXCLUDED.is_active,
  sort_order = EXCLUDED.sort_order,
  total_sessions = EXCLUDED.total_sessions,
  session_schedule_type = EXCLUDED.session_schedule_type,
  updated_at = NOW();
  `.trim();

  sqlStatements.push(sql);
});

sqlStatements.push('COMMIT;');

const fullSql = sqlStatements.join('\n');
const outPath = path.join(__dirname, 'sync_catalog.sql');
fs.writeFileSync(outPath, fullSql, 'utf8');

console.log(`Generated SQL to ${outPath} (${sqlStatements.length - 2} upsert statements)`);
