#!/bin/bash
docker exec wa-clinic-bot-postgres-1 psql -U postgres -d wa_clinic_db -c "SELECT COUNT(*) as total_reservations FROM reservations;"
docker exec wa-clinic-bot-postgres-1 psql -U postgres -d wa_clinic_db -c "SELECT c.name, c.phone, r.treatment_detail, r.booking_date FROM customers c JOIN reservations r ON c.id = r.customer_id WHERE c.phone LIKE '000000000%' ORDER BY r.booking_date;"