#!/bin/bash

# Ellen
docker exec wa-clinic-bot-postgres-1 psql -U postgres -d wa_clinic_db -c "
INSERT INTO customers (id, name, phone, kelurahan, created_at, updated_at)
VALUES (gen_random_uuid(), 'Bunda Ellen, Anggaswangi', '0000000001', 'Anggaswangi', NOW(), NOW())
RETURNING id;
"

# Get Ellen ID and insert reservation
docker exec wa-clinic-bot-postgres-1 psql -U postgres -d wa_clinic_db -c "
WITH c AS (
  SELECT id FROM customers WHERE phone = '0000000001' LIMIT 1
)
INSERT INTO reservations (id, customer_id, treatment_category, booking_date, treatment_detail, is_repeat_order, status, purchase_value, created_at, updated_at)
SELECT gen_random_uuid(), c.id, 'BABY', '2026-05-21T08:00:00', 'Pijat ceria', false, 'completed', 70000, NOW(), NOW()
FROM c;
"

# Himatus
docker exec wa-clinic-bot-postgres-1 psql -U postgres -d wa_clinic_db -c "
INSERT INTO customers (id, name, phone, kelurahan, created_at, updated_at)
VALUES (gen_random_uuid(), 'Bunda Himatus, Kepuhkiriman', '0000000002', 'Kepuhkiriman', NOW(), NOW())
RETURNING id;
"

docker exec wa-clinic-bot-postgres-1 psql -U postgres -d wa_clinic_db -c "
WITH c AS (
  SELECT id FROM customers WHERE phone = '0000000002' LIMIT 1
)
INSERT INTO reservations (id, customer_id, treatment_category, booking_date, treatment_detail, is_repeat_order, status, purchase_value, created_at, updated_at)
SELECT gen_random_uuid(), c.id, 'BABY', '2026-07-02T08:00:00', 'Pijat pulih ceria', false, 'completed', 70000, NOW(), NOW()
FROM c;
"

# Iren
docker exec wa-clinic-bot-postgres-1 psql -U postgres -d wa_clinic_db -c "
INSERT INTO customers (id, name, phone, kelurahan, created_at, updated_at)
VALUES (gen_random_uuid(), 'Bunda Iren, Sarirogo', '0000000003', 'Sarirogo', NOW(), NOW())
RETURNING id;
"

docker exec wa-clinic-bot-postgres-1 psql -U postgres -d wa_clinic_db -c "
WITH c AS (
  SELECT id FROM customers WHERE phone = '0000000003' LIMIT 1
)
INSERT INTO reservations (id, customer_id, treatment_category, booking_date, treatment_detail, is_repeat_order, status, purchase_value, created_at, updated_at)
SELECT gen_random_uuid(), c.id, 'BABY', '2026-08-28T08:00:00', 'Pijat ceria', false, 'completed', 80000, NOW(), NOW()
FROM c;
"

echo "Done!"