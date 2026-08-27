#!/bin/bash

# Create customer: Anggi
ANGGI_ID=$(docker exec wa-clinic-bot-postgres-1 psql -U postgres -d wa_clinic_db -t -A -c "INSERT INTO customers (id, name, phone, kelurahan, created_at, updated_at) VALUES (gen_random_uuid(), 'Bunda Anggi, Sememi', '6285706086863', 'Sememi', NOW(), NOW()) RETURNING id;")
echo "Anggi ID: $ANGGI_ID"

# Create customer: Goby
GOBY_ID=$(docker exec wa-clinic-bot-postgres-1 psql -U postgres -d wa_clinic_db -t -A -c "INSERT INTO customers (id, name, phone, kelurahan, created_at, updated_at) VALUES (gen_random_uuid(), 'Bunda Goby, Dukuh Pakis', '6281241245461', 'Dukuh Pakis', NOW(), NOW()) RETURNING id;")
echo "Goby ID: $GOBY_ID"

# Create customer: Briel
BRIEL_ID=$(docker exec wa-clinic-bot-postgres-1 psql -U postgres -d wa_clinic_db -t -A -c "INSERT INTO customers (id, name, phone, kelurahan, created_at, updated_at) VALUES (gen_random_uuid(), 'Bunda Briell, Gadel Timur', '6283856165785', 'Gadel Timur', NOW(), NOW()) RETURNING id;")
echo "Briel ID: $BRIEL_ID"

# Add reservations for Anggi (24/4/2026)
docker exec wa-clinic-bot-postgres-1 psql -U postgres -d wa_clinic_db -c "INSERT INTO reservations (id, customer_id, booking_date, treatment_detail, is_repeat_order, status, purchase_value, ongkir, created_at, updated_at) VALUES (gen_random_uuid(), '$ANGGI_ID', '2026-04-24T08:00:00', 'Cukur gundul + pijat bayi pulih ceria', false, 'completed', 110000, 25000, NOW(), NOW());"

# Add reservations for Goby (17/5/2026)
docker exec wa-clinic-bot-postgres-1 psql -U postgres -d wa_clinic_db -c "INSERT INTO reservations (id, customer_id, booking_date, treatment_detail, is_repeat_order, status, purchase_value, ongkir, created_at, updated_at) VALUES (gen_random_uuid(), '$GOBY_ID', '2026-05-17T08:00:00', 'pijat pulih ceria', false, 'completed', 85000, 15000, NOW(), NOW());"

# Add reservations for Briel (11/7/2026)
docker exec wa-clinic-bot-postgres-1 psql -U postgres -d wa_clinic_db -c "INSERT INTO reservations (id, customer_id, booking_date, treatment_detail, is_repeat_order, status, purchase_value, ongkir, created_at, updated_at) VALUES (gen_random_uuid(), '$BRIEL_ID', '2026-07-11T08:00:00', 'Pijat bayi pulih ceria', false, 'completed', 105000, 20000, NOW(), NOW());"

echo "Done!"