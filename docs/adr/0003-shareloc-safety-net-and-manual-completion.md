# Shareloc Safety Net and Manual Service Completion

## Context
Homecare visits require precise customer location (shareloc / GPS coordinates) for therapist route planning. Relying purely on manual staff requests often resulted in staff forgetting to follow up before visit day, while aggressive immediate bot prompting risked irritating customers during odd hours. Furthermore, automated status transitions to `completed` risked premature customer reviews if visits were delayed or rescheduled.

## Decision
1. Implement a 2-stage Shareloc Safety Net: If a reservation lacks GPS coordinates and the customer has no prior saved shareloc, highlight the reservation card in the dashboard after 1 hour. If still unresolved after 3 hours, the Bot sends an automated polite location request, strictly restricted to operating hours (08:00–20:00 WIB) with quiet-hour postponement.
2. Mandate manual service completion: Reservations may only transition to `completed` through explicit administrative staff action, completely forbidding automated cron timer completion.

## Consequences
Therapists reliably receive navigation coordinates with zero overnight customer disturbance. Service records and post-service follow-ups reflect verified clinical reality.
