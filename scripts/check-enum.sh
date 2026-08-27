#!/bin/bash
docker exec wa-clinic-bot-postgres-1 psql -U postgres -d wa_clinic_db -c "SELECT enumlabel FROM pg_enum WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'TreatmentCategory');"