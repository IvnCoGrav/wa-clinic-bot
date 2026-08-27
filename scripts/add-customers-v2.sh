#!/bin/bash
# Anggi reservation (already created above)
ANGGI_ID="dfe79803-7123-4f7a-912c-73658fb400df"
GOBY_ID="400961d0-4b46-44e3-90d0-aeb5427d7e53"
BRIEL_ID="fa1ec752-7855-4048-8c62-bd2545e46bdc"

# Anggi 24/4 - Cukur gundul + pijat bayi pulih ceria = BABY
docker exec wa-clinic-bot-postgres-1 psql -U postgres -d wa_clinic_db -c "INSERT INTO reservations (id, customer_id, treatment_category, booking_date, treatment_detail, is_repeat_order, status, purchase_value, created_at, updated_at) VALUES (gen_random_uuid(), '$ANGGI_ID', 'BABY', '2026-04-24T08:00:00', 'Cukur gundul + pijat bayi pulih ceria', false, 'completed', 110000, NOW(), NOW());"

# Goby 17/5 - pijat pulih ceria = BABY
docker exec wa-clinic-bot-postgres-1 psql -U postgres -d wa_clinic_db -c "INSERT INTO reservations (id, customer_id, treatment_category, booking_date, treatment_detail, is_repeat_order, status, purchase_value, created_at, updated_at) VALUES (gen_random_uuid(), '$GOBY_ID', 'BABY', '2026-05-17T08:00:00', 'pijat pulih ceria', false, 'completed', 85000, NOW(), NOW());"

# Briel 11/7 - Pijat bayi pulih ceria = BABY
docker exec wa-clinic-bot-postgres-1 psql -U postgres -d wa_clinic_db -c "INSERT INTO reservations (id, customer_id, treatment_category, booking_date, treatment_detail, is_repeat_order, status, purchase_value, created_at, updated_at) VALUES (gen_random_uuid(), '$BRIEL_ID', 'BABY', '2026-07-11T08:00:00', 'Pijat bayi pulih ceria', false, 'completed', 105000, NOW(), NOW());"

echo "Done: 3 reservations added"