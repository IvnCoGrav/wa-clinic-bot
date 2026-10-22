# Silent Payment Reconciliation and LiveChat Recorded Banner

## Context
When customers upload payment transfer slips to WhatsApp, automated chatbots often risk confronting customers awkwardly if the amount is slightly mismatched or lacks context (e.g. split payments, tips, or promos). Additionally, the LiveChat dashboard previously prompted staff to schedule reservations even after an automated booking had succeeded, creating confusion.

## Decision
1. For payment receipts, the system performs OCR / Vision AI verification silently: if nominal amounts match, it marks the reservation as paid; if amounts differ, it refrains from rebuking the customer in chat and instead attaches an internal mismatch warning note (`[TRANSFER_MISMATCH]`) directly on the reservation record for admin review.
2. In LiveChatMonitor, when an active reservation already exists for the detected slot, the banner switches to green/cyan ("RESERVASI OTOMATIS TERCATAT (BOT)") with a "Lihat Detail Reservasi" action, suppressing the duplicate scheduling button.

## Consequences
Customers experience polite, friction-free interactions while administrative staff maintain full accounting oversight of payment discrepancies. Staff are prevented from inadvertently creating duplicate reservations.
