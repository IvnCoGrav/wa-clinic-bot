#!/bin/bash

# Ellen - Anggaswangi - 21/5/26
ELLEN_ID=$(docker exec wa-clinic-bot-postgres-1 psql -U postgres -d wa_clinic_db -t -A -c "INSERT INTO customers (id, name, phone, kelurahan, created_at, updated_at) VALUES (gen_random_uuid(), 'Bunda Ellen, Anggaswangi', '0000000001', 'Anggaswangi', NOW(), NOW()) RETURNING id;")
echo "Ellen ID: $ELLEN_ID"
docker exec wa-clinic-bot-postgres-1 psql -U postgres -d wa_clinic_db -c "INSERT INTO reservations (id, customer_id, treatment_category, booking_date, treatment_detail, is_repeat_order, status, purchase_value, created_at, updated_at) VALUES (gen_random_uuid(), '$ELLEN_ID', 'BABY', '2026-05-21T08:00:00', 'Pijat ceria', false, 'completed', 70000, NOW(), NOW());"

# Himatus - Kepuhkiriman - Ny. Jena - 2/7/26
HIMATUS_ID=$(docker exec wa-clinic-bot-postgres-1 psql -U postgres -d wa_clinic_db -t -A -c "INSERT INTO customers (id, name, phone, kelurahan, created_at, updated_at) VALUES (gen_random_uuid(), 'Bunda Himatus, Kepuhkiriman', '0000000002', 'Kepuhkiriman', NOW(), NOW()) RETURNING id;")
echo "Himatus ID: $HIMATUS_ID"
docker exec wa-clinic-bot-postgres-1 psql -U postgres -d wa_clinic_db -c "INSERT INTO reservations (id, customer_id, treatment_category, booking_date, treatment_detail, is_repeat_order, status, purchase_value, created_at, updated_at) VALUES (gen_random_uuid(), '$HIMATUS_ID', 'BABY', '2026-07-02T08:00:00', 'Pijat pulih ceria', false, 'completed', 70000, NOW(), NOW());"

# Iren - Sarirogo - By. Jay - 28/8/26
IREN_ID=$(docker exec wa-clinic-bot-postgres-1 psql -U postgres -d wa_clinic_db -t -A -c "INSERT INTO customers (id, name, phone, kelurahan, created_at, updated_at) VALUES (gen_random_uuid(), 'Bunda Iren, Sarirogo', '0000000003', 'Sarirogo', NOW(), NOW()) RETURNING id;")
echo "Iren ID: $IREN_ID"
docker exec wa-clinic-bot-postgres-1 psql -U postgres -d wa_clinic_db -c "INSERT INTO reservations (id, customer_id, treatment_category, booking_date, treatment_detail, is_repeat_order, status, purchase_value, created_at, updated_at) VALUES (gen_random_uuid(), '$IREN_ID', 'BABY', '2026-08-28T08:00:00', 'Pijat ceria', false, 'completed', 80000, NOW(), NOW());"

echo "Done!"