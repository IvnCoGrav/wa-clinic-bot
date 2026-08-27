#!/bin/bash

# Ellen - Anggaswangi - An. Shafiyyah - Pijat ceria - 21/5/26 - Rp70.000
ELLEN_ID=$(docker exec wa-clinic-bot-postgres-1 psql -U postgres -d wa_clinic_db -t -A -c "INSERT INTO customers (id, name, phone, kelurahan, created_at, updated_at) VALUES (gen_random_uuid(), 'Bunda Ellen, Anggaswangi', '0', 'Anggaswangi', NOW(), NOW()) RETURNING id;")
echo "Ellen ID: $ELLEN_ID"
docker exec wa-clinic-bot-postgres-1 psql -U postgres -d wa_clinic_db -c "INSERT INTO reservations (id, customer_id, treatment_category, booking_date, treatment_detail, is_repeat_order, status, purchase_value, created_at, updated_at) VALUES (gen_random_uuid(), '$ELLEN_ID', 'BABY', '2026-05-21T08:00:00', 'Pijat ceria', false, 'completed', 70000, NOW(), NOW());"

# Himatus - Kepuhkiriman - Ny. Jena - Pijat pulih ceria - 2/7/26 - Rp70.000
HIMATUS_ID=$(docker exec wa-clinic-bot-postgres-1 psql -U postgres -d wa_clinic_db -t -A -c "INSERT INTO customers (id, name, phone, kelurahan, created_at, updated_at) VALUES (gen_random_uuid(), 'Bunda Himatus, Kepuhkiriman', '0', 'Kepuhkiriman', NOW(), NOW()) RETURNING id;")
echo "Himatus ID: $HIMATUS_ID"
docker exec wa-clinic-bot-postgres-1 psql -U postgres -d wa_clinic_db -c "INSERT INTO reservations (id, customer_id, treatment_category, booking_date, treatment_detail, is_repeat_order, status, purchase_value, created_at, updated_at) VALUES (gen_random_uuid(), '$HIMATUS_ID', 'BABY', '2026-07-02T08:00:00', 'Pijat pulih ceria', false, 'completed', 70000, NOW(), NOW());"

# Iren - Sarirogo - By. Jay - Pijat ceria - 28/8/26 - Rp80.000
IREN_ID=$(docker exec wa-clinic-bot-postgres-1 psql -U postgres -d wa_clinic_db -t -A -c "INSERT INTO customers (id, name, phone, kelurahan, created_at, updated_at) VALUES (gen_random_uuid(), 'Bunda Iren, Sarirogo', '0', 'Sarirogo', NOW(), NOW()) RETURNING id;")
echo "Iren ID: $IREN_ID"
docker exec wa-clinic-bot-postgres-1 psql -U postgres -d wa_clinic_db -c "INSERT INTO reservations (id, customer_id, treatment_category, booking_date, treatment_detail, is_repeat_order, status, purchase_value, created_at, updated_at) VALUES (gen_random_uuid(), '$IREN_ID', 'BABY', '2026-08-28T08:00:00', 'Pijat ceria', false, 'completed', 80000, NOW(), NOW());"

echo "Done: 3 customers + reservations added"