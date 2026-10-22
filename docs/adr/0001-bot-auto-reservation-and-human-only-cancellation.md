# Bot Auto-Generated Reservations with Visual Distinction and Human-Only Cancellation

## Context
Clinic homecare appointments were previously caught in a dual-authority conflict where the AI Bot could autonomously create reservations while the admin dashboard also prompted staff to schedule them, causing confusion over ownership and double-entry fears. Furthermore, flexible cancellation without financial commitment (no DP) posed high no-show and route-disruption risks.

## Decision
We retain the AI Bot's capability to auto-generate reservations (`source: 'AGENT'`) upon valid customer commitment, but mandate distinct UI coloring and explicit "Auto Generated" badges in the admin dashboard so staff are immediately aware. Crucially, the Bot is strictly forbidden from cancelling or rescheduling reservations; any cancellation or reschedule request from chat must escalate directly to `HUMAN_HANDLING` for staff intervention.

## Consequences
Admin staff have instant awareness of automated bookings without duplicate scheduling prompts. Midwife travel schedules remain protected from autonomous AI cancellations.
