# DESIGN.md — Clinic Bot & Admin Dashboard Design System

This file defines the visual language, interaction patterns, and craft standards for the WhatsApp Clinic Bot admin dashboard and customer-facing interfaces.

---

## 1. Brand Identity & Color Tokens

| Token Name | Hex Code / Tailwind | Usage |
| :--- | :--- | :--- |
| **Brand Primary** | `#008069` (`text-emerald-700`) | Main CTA buttons, active tabs, header icons, brand accents |
| **Brand Hover** | `#00a884` | Hover state for primary buttons and interactive links |
| **Brand Mint / Soft** | `#e8f5f2` / `bg-emerald-50` | Active selection backgrounds, subtle pill badges |
| **Text Primary** | `#111b21` | High-contrast body text, headings, table contents |
| **Text Secondary** | `#54656f` | Muted labels, table headers, descriptions, timestamps |
| **Text Subtle** | `#8696a0` | Placeholders, inactive icons, helper text |
| **Border Neutral** | `#e9edef` / `#d1d7db` | Card borders, table dividers, input borders |
| **App Canvas** | `#f0f2f5` | Page background canvas (WhatsApp web background style) |
| **Surface Card** | `#ffffff` | Elevated cards, popovers, dropdowns, modal windows |

---

## 2. Status Color Matrix

| Status | Badge Background | Text Color | Border | Usage |
| :--- | :--- | :--- | :--- | :--- |
| **Success / Connected** | `bg-emerald-50` | `text-emerald-800` | `border-emerald-200` | Terhubung, Selesai, Confirmed |
| **Pending / Warning** | `bg-amber-50` | `text-amber-800` | `border-amber-200` | Belum Terhubung, Pending, Follow-Up |
| **Info / Scheduled** | `bg-sky-50` | `text-sky-800` | `border-sky-200` | Jadwal Booking, AI Active |
| **Danger / Canceled** | `bg-rose-50` | `text-rose-800` | `border-rose-200` | Gagal, Batal, Emergency Alert |

---

## 3. Component Architecture Guidelines

### Modals & Dialogs
- **Backdrop**: `fixed inset-0 bg-black/40 backdrop-blur-xs z-50 flex items-center justify-center p-4`
- **Container**: `bg-white rounded-2xl sm:rounded-3xl border border-[#e9edef] shadow-2xl w-full max-w-lg overflow-hidden animate-fadeIn`
- **Header**: Clean flex header with title, subtitle, and prominent close button (`X` icon, `text-[#54656f] hover:text-[#111b21]`).
- **Footer**: Distinct actions with primary on right (`bg-[#008069] hover:bg-[#00a884] text-white`) and cancel/secondary on left (`border border-[#d1d7db] text-[#54656f]`).

### Form Inputs & Dropdowns
- **Height & Spacing**: Minimum height `38px` (desktop) / `42px` (mobile).
- **Styling**: `w-full px-3 py-2 bg-white border border-[#d1d7db] rounded-xl text-xs sm:text-sm text-[#111b21] placeholder-[#8696a0] focus:outline-hidden focus:border-[#008069] focus:ring-1 focus:ring-[#008069]`
- **Labels**: `text-xs font-semibold text-[#111b21] mb-1.5 flex items-center justify-between`

---

## 4. Impeccable Quality Checklist
- [x] No generic AI purple gradients or cliché card nesting.
- [x] High-contrast typography (WCAG AA compliant).
- [x] Clear hover, active, focus, and loading states for every clickable element.
- [x] Consistent rounded corner hierarchy (`rounded-xl` for controls, `rounded-2xl` for containers).
- [x] In-app toast feedback instead of native browser `alert()` or `confirm()`.
