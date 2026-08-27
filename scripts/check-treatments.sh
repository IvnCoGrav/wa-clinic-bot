#!/bin/bash
docker exec wa-clinic-bot-postgres-1 psql -U postgres -d wa_clinic_db -c "SELECT DISTINCT treatment_detail, treatment_category FROM reservations ORDER BY treatment_detail LIMIT 50;"