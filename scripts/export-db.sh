#!/bin/bash
# Export customers to JSON
docker exec wa-clinic-bot-postgres-1 psql -U postgres -d wa_clinic_db -t -A -c "SELECT json_agg(json_build_object('id', id::text, 'name', name, 'phone', phone)) FROM customers WHERE is_sandbox_test = false;" > /tmp/customers.json

# Export reservations to JSON
docker exec wa-clinic-bot-postgres-1 psql -U postgres -d wa_clinic_db -t -A -c "SELECT json_agg(json_build_object('id', id::text, 'customer_id', customer_id::text, 'booking_date', booking_date::text, 'treatment_detail', treatment_detail, 'status', status)) FROM reservations;" > /tmp/reservations.json

echo "Export complete"