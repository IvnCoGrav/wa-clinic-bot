#!/bin/bash

# Find existing Goby customer
GOBY_ID=$(docker exec wa-clinic-bot-postgres-1 psql -U postgres -d wa_clinic_db -t -A -c "SELECT id FROM customers WHERE phone = '6281241245461';")
echo "Goby ID: $GOBY_ID"

# Find existing Briel customer
BRIEL_ID=$(docker exec wa-clinic-bot-postgres-1 psql -U postgres -d wa_clinic_db -t -A -c "SELECT id FROM customers WHERE phone = '6283856165785';")
echo "Briel ID: $BRIEL_ID"

# Add reservation for Anggi (24/4/2026)
docker exec wa-clinic-bot-postgres-1 psql -U postgres -d wa_clinic_db -c "INSERT INTO reservations (id, customer_id, booking_date, treatment_detail, is_repeat_order, status, purchase_value, created_at, updated_at) VALUES (gen_random_uuid(), 'dfe79803-7123-4f7a-912c-73658fb400df', '2026-04-24T08:00:00', 'Cukur gundul + pijat bayi pulih ceria', false, 'completed', 110000, NOW(), NOW());"

# Add reservation for Goby (17/5/2026)
docker exec wa-clinic-bot-postgres-1 psql -U postgres -d wa_clinic_db -c "INSERT INTO reservations (id, customer_id, booking_date, treatment_detail, is_repeat_order, status, purchase_value, created_at, updated_at) VALUES (gen_random_uuid(), '$GOBY_ID', '2026-05-17T08:00:00', 'pijat pulih ceria', false, 'completed', 85000, NOW(), NOW());"

# Add reservation for Briel (11/7/2026)
docker exec wa-clinic-bot-postgres-1 psql -U postgres -d wa_clinic_db -c "INSERT INTO reservations (id, customer_id, booking_date, treatment_detail, is_repeat_order, status, purchase_value, created_at, updated_at) VALUES (gen_random_uuid(), '$BRIEL_ID', '2026-07-11T08:00:00', 'Pijat bayi pulih ceria', false, 'completed', 105000, NOW(), NOW());"

echo "Done!"