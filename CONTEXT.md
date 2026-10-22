# Reservation & Clinic Care Context

Domain model for clinic homecare reservation, therapist scheduling, and customer consultation.

## Language

**Reservation**:
A scheduled appointment for homecare clinical services for a customer (mother, baby, or children) on a specific calendar date and time.
_Avoid_: Booking, order, ticket

**Bot-Generated Reservation (Auto)**:
An appointment created automatically by the AI chatbot or WhatsApp form ingestion (`source: 'AGENT'`), visually marked with a distinct colored icon (e.g. 🤖) in the admin UI so staff are explicitly aware of automated creation.
_Avoid_: Unattended booking, ghost booking

**Manual Reservation**:
An appointment created directly by clinic staff via the dashboard modal (`source: 'MANUAL'`), marked with a staff icon (👤).
_Avoid_: CS input, offline booking

**Recorded Reservation Banner**:
The LiveChat banner state rendered in green/cyan displaying "RESERVASI OTOMATIS TERCATAT (BOT)" and providing a "Lihat Detail Reservasi" action while suppressing the duplicate scheduling button.
_Avoid_: Intake banner, schedule button

**Human-Only Cancellation**:
The operational invariant where cancellations and schedule changes (reschedule) can only be processed by human staff; the bot is forbidden from modifying or cancelling reservation records and must escalate to `HUMAN_HANDLING`.
_Avoid_: Autonomous cancellation, self-serve reschedule

**Human-Handling Escalation Lock**:
The state where a chat session transferred to staff (such as upon cancellation or reschedule requests) remains under human control indefinitely without autonomous bot resumption until staff explicitly releases it.
_Avoid_: Auto-resume, timeout takeover

**Slot Buffer**:
A fixed 20-minute rest, sanitation, and travel window automatically appended to every reservation duration before the next appointment can begin.
_Avoid_: Travel time allowance, break window, margin

**Single-Therapist Sequential Treatment**:
A multi-service or multi-patient appointment fulfilled by a single therapist sequentially in one visit, calculating the blocked slot as the sum of all treatment durations plus the slot buffer.
_Avoid_: Parallel booking, tandem dispatch

**Silent Reconciliation**:
The payment receipt verification flow where transferred amounts are checked against the reservation bill, with any discrepancies (underpaid/overpaid) reported as internal admin notes and alerts without customer-facing confrontation.
_Avoid_: Bot collection message, customer billing rebuke

**Shareloc Safety Net**:
A multi-tiered location assurance protocol where missing coordinates trigger an admin visual card warning after 1 hour, followed by an automated bot WhatsApp request after 3 hours during active hours (08:00–20:00 WIB), bypassing alerts if historical coordinates exist.
_Avoid_: Immediate location spam, 24-hour nagging

**Manual Service Completion**:
The transition of a reservation to `completed` performed exclusively by administrative staff after service delivery, strictly prohibiting automated cron-based completion.
_Avoid_: Auto-complete, timer completion
