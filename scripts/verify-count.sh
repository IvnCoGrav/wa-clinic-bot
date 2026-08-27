#!/bin/bash
docker exec wa-clinic-bot-postgres-1 psql -U postgres -d wa_clinic_db -c "SELECT COUNT(*) as total_reservations FROM reservations;"