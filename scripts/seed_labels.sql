INSERT INTO labels (id, tenant_id, name, color, created_at, updated_at)
VALUES 
  (gen_random_uuid(), 'default-tenant', 'Hold', '#dc2626', NOW(), NOW()),
  (gen_random_uuid(), 'default-tenant', 'Admin (CS)', '#7c3aed', NOW(), NOW()),
  (gen_random_uuid(), 'default-tenant', 'Pending Payment', '#d97706', NOW(), NOW()),
  (gen_random_uuid(), 'default-tenant', 'Repeat Order', '#059669', NOW(), NOW()),
  (gen_random_uuid(), 'default-tenant', 'New Customer', '#0284c7', NOW(), NOW()),
  (gen_random_uuid(), 'default-tenant', 'Medical Emergency', '#e11d48', NOW(), NOW()),
  (gen_random_uuid(), 'default-tenant', 'Unresolved FAQ', '#ea580c', NOW(), NOW()),
  (gen_random_uuid(), 'default-tenant', 'MQL (Hot Lead)', '#10b981', NOW(), NOW())
ON CONFLICT (tenant_id, name) DO NOTHING;
