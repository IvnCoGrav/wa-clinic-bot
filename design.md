---
version: alpha
name: WhatsApp
description: "Use WhatsApp Messenger to stay in touch with friends and family. WhatsApp is free and offers simple, secure, reliable messaging and calling, available on phones all over the world."
sourceUrl: "https://whatsapp.com"

colors:
  text: "#1c1e21"
  accent: "#111b21"
  border: "#111b21"
  primary: "#1c1e21"
  surface: "#fcf5eb"
  background: "#111b21"
  on-primary: "#ffffff"
  text-muted: "#ffffff"

whatsappWebLightTokens:
  appBackground: "#f0f2f5"
  sidebarHeader: "#f0f2f5"
  chatCanvas: "#efeae2"
  inboundBubble: "#ffffff"
  outboundBubble: "#d9fdd3"
  primaryGreen: "#008069"
  accentGreen: "#00a884"
  blueDoubleTicks: "#53bdeb"
  textPrimary: "#111b21"
  textSecondary: "#667781"
  borderSubtle: "#e9edef"

typography:
  display:
    fontFamily: "WhatsApp Sans Var"
    fontSize: 32px
    fontWeight: 400
    lineHeight: 1
  heading:
    fontFamily: "WhatsApp Sans Var"
    fontSize: 24px
    fontWeight: 400
    lineHeight: 1.34
  body:
    fontFamily: "WhatsApp Sans Var"
    fontSize: 18px
    fontWeight: 400
    lineHeight: 1.39

spacing:
  base: 4px
  scale: [4, 8, 16, 20, 24, 28, 32, 40, 56, 60]

radius:
  md: 50px
  sm: 25px

shadows:
  card: "rgba(0, 0, 0, 0.2) 0px 10px 30px 0px, rgba(0, 0, 0, 0.1) 0px 4px 6px 0px"
  elevated: "rgba(0, 0, 0, 0.2) 0px 10px 30px 0px, rgba(0, 0, 0, 0.1) 0px 4px 6px 0px"

motion:
  duration-fast: 330ms
  duration-base: 670ms
  duration-slow: 1000ms
  easing: "cubic-bezier(0.2, 0, 0, 1)"

breakpoints: [240px, 500px, 600px, 640px, 767px, 768px, 801px, 1024px, 1025px, 1096px, 1175px, 1177px, 1200px]
---

## Rationale

Measured design tokens extracted from https://whatsapp.com. The frontmatter above is the design system — real colors, type scale, spacing, radius, shadows, motion, and breakpoints read from the live page.

---

# Anti-Slop Frontend Guidelines & Design System Reference

> Landing pages, portals, portfolios, and redesigns.
> Every rule below is **contextual**. None of it fires automatically. First read the brief, then pull only what fits.

---

## 0. BRIEF INFERENCE (Read the Room Before Anything Else)

Before touching code or tweaking dials, **infer what the user actually wants**. Most LLM design output is bad because the model jumps to a default aesthetic instead of reading the room.

### 0.A Read these signals first
1. **Page kind** - landing (SaaS / consumer / agency / event), portal / dashboard, portfolio (dev / designer / creative studio), redesign (preserve vs overhaul), editorial / blog.
2. **Vibe words** the user used - "minimalist", "calm", "Linear-style", "Awwwards", "brutalist", "premium consumer", "Apple-y", "playful", "serious B2B", "editorial", "agency-y", "glassy", "dark tech".
3. **Reference signals** - URLs they linked, screenshots they pasted, products they named, brands they're competing with.
4. **Audience** - B2B procurement panel vs. design-conscious consumer vs. recruiter scanning a portfolio vs. clinical staff. The audience picks the aesthetic, not your taste.
5. **Brand assets that already exist** - logo, color, type, photography. For redesigns, these are starting material, not optional input (see Section 11).
6. **Quiet constraints** - accessibility-first audiences, public-sector, regulated industries, trust-first commerce, kids' products. These constraints OVERRIDE aesthetic preference.

### 0.B Output a one-line "Design Read" before generating
Before any code, state in one line: **"Reading this as: <page kind> for <audience>, with a <vibe> language, leaning toward <design system or aesthetic family>."**

### 0.C If the brief is ambiguous, ask one question, do not guess
Ask exactly **one** clarifying question - never a multi-question dump - and only when the design read genuinely diverges.

If you can confidently infer from context, **do not ask**. Just declare the design read and proceed.

### 0.D Anti-Default Discipline
Do not default to: AI-purple gradients, centered hero over dark mesh, three equal feature cards, generic glassmorphism on everything, infinite-loop micro-animations everywhere, Inter + slate-900. These are the LLM defaults. Reach past them deliberately based on the design read.

---

## 1. THE THREE DIALS (Core Configuration)

After the design read, set three dials. Every layout, motion, and density decision below is gated by these.

* **`DESIGN_VARIANCE: 8`** - 1 = Perfect Symmetry, 10 = Artsy Chaos
* **`MOTION_INTENSITY: 6`** - 1 = Static, 10 = Cinematic / Physics
* **`VISUAL_DENSITY: 4`** - 1 = Art Gallery / Airy, 10 = Cockpit / Packed Data

**Baseline:** `8 / 6 / 4`. Use these unless the design read overrides them.

### 1.A Dial Inference (design read -> dial values)
| Signal | VARIANCE | MOTION | DENSITY |
|---|---|---|---|
| "minimalist / clean / calm / editorial / Linear-style" | 5-6 | 3-4 | 2-3 |
| "premium consumer / Apple-y / luxury / brand" | 7-8 | 5-7 | 3-4 |
| "playful / wild / Dribbble / Awwwards / experimental / agency" | 9-10 | 8-10 | 3-4 |
| "landing page / portfolio / marketing site (default)" | 7-9 | 6-8 | 3-5 |
| "trust-first / public-sector / regulated / accessibility-critical" | 3-4 | 2-3 | 4-5 |
| "redesign - preserve" | match existing | +1 | match existing |
| "redesign - overhaul" | +2 | +2 | match existing |

---

## 2. BRIEF -> DESIGN SYSTEM MAP

### 2.A When to reach for a real design system (use official packages)
| Brief reads as... | Reach for | Why |
|---|---|---|
| Microsoft / enterprise SaaS / dashboards | `@fluentui/react-components` | Official Fluent UI, Microsoft tokens, accessibility done |
| Google-ish UI, Material-flavored product | `@material/web` + Material 3 tokens | Official, theme-able via Material Theming |
| IBM-style B2B / enterprise analytics | `@carbon/react` + `@carbon/styles` | Official Carbon, mature data-density patterns |
| Modern accessible React foundation | `@radix-ui/themes` | Primitives + polished theme |
| Modern SaaS where you own the components | shadcn/ui | You own the code, easy to customise |
| Tailwind-based modern SaaS / AI marketing | Tailwind v4 utilities + `dark:` variant | Default for modern app builds |

### 2.B When the brief is an aesthetic, not a system
| Aesthetic | Honest implementation |
|---|---|
| Glassmorphism / "frosted glass" | `backdrop-filter`, layered borders, highlight overlays. Provide solid-fill fallback for `prefers-reduced-transparency`. |
| Bento (Apple-style tile grids) | CSS Grid with mixed cell sizes. No single library owns this. |
| Brutalism | Native CSS, monospace, raw borders. No library. |
| Editorial / magazine | Serif type, asymmetric grid, generous whitespace. No library. |
| Dark tech / hacker | Mono + accent neon, terminal motifs. No library. |
| Aurora / mesh gradients | SVG or layered radial gradients. No library. |
| Kinetic typography | Native CSS animations, scroll-driven animations, GSAP for hijacks. No library. |
| **Apple Liquid Glass** | Web implementations are approximations using `backdrop-filter` + layered borders + highlights. |

---

## 3. DEFAULT ARCHITECTURE & CONVENTIONS

### 3.A Stack
* **Framework:** React or Next.js.
* **Styling:** **Tailwind CSS**.
* **Animation:** **Motion** (`motion/react`).
* **Fonts:** Self-host with `@font-face` + `font-display: swap` or `next/font`.

### 3.B State
* Local `useState` / `useReducer` for isolated UI.
* Global state ONLY for deep prop-drilling avoidance.
* **NEVER** use `useState` to track continuous values driven by user input (mouse position, scroll progress, pointer physics). Use Motion's `useMotionValue` / `useTransform` / `useScroll`.

### 3.C Icons
* **Allowed libraries (priority order):** `@phosphor-icons/react`, `hugeicons-react`, `@radix-ui/react-icons`, `@tabler/icons-react`, `lucide-react`.
* **NEVER hand-roll SVG icons.** Standardize `strokeWidth` globally (e.g. `1.5` or `2.0`).

### 3.D Emoji Policy
Discouraged by default in code, markup, and visible text. Replace symbols with icon-library glyphs.

### 3.E Responsiveness & Layout Mechanics
* Standardize breakpoints (`sm 640`, `md 768`, `lg 1024`, `xl 1280`, `2xl 1536`).
* Contain page layouts using `max-w-[1400px] mx-auto` or `max-w-7xl`.
* **Viewport Stability:** NEVER use `h-screen` for full-height Hero sections. ALWAYS use `min-h-[100dvh]` to prevent layout jumping on mobile (iOS Safari address bar).
* **Grid over Flex-Math:** NEVER use complex flexbox percentage math (`w-[calc(33%-1rem)]`). ALWAYS use CSS Grid (`grid grid-cols-1 md:grid-cols-3 gap-6`).

---

## 4. DESIGN ENGINEERING DIRECTIVES (Bias Correction)

### 4.1 Typography
* **Display / Headlines:** Default `text-4xl md:text-6xl tracking-tighter leading-none`.
* **Body / Paragraphs:** Default `text-base text-gray-600 leading-relaxed max-w-[65ch]`.
* **Sans font choice:** `Geist`, `Outfit`, `Cabinet Grotesk`, `Satoshi`, `WhatsApp Sans Var`.
* **ITALIC DESCENDER CLEARANCE (mandatory):** When italic is used in display type and the word contains a descender letter (`y g j p q`), `leading-[1]` will clip the descender. Use `leading-[1.1]` minimum and add `pb-1` reserve.

### 4.2 Color Calibration
* Max 1 accent color. Saturation < 80% by default.
* **THE LILA RULE:** The "AI Purple / Blue glow" aesthetic is discouraged as a default. Use neutral bases with high-contrast singular accents.
* **COLOR CONSISTENCY LOCK (mandatory):** Once an accent color is chosen for a page, it is used on the WHOLE page.

### 4.3 Layout Diversification
* **ANTI-CENTER BIAS:** Centered Hero / H1 sections are avoided when `DESIGN_VARIANCE > 4`. Force "Split Screen" (50/50), "Left-aligned content / right-aligned asset", or asymmetric structures.

### 4.4 Materiality, Shadows, Cards
* Use cards ONLY when elevation communicates real hierarchy.
* Tint shadows to the background hue. No pure-black drop shadows on light backgrounds.
* **SHAPE CONSISTENCY LOCK (mandatory):** Pick ONE corner-radius scale for the page and stick to it.

### 4.5 Interactive UI States
* **Loading:** Skeletal loaders matching the final layout's shape.
* **Empty States:** Beautifully composed; indicate how to populate.
* **Error States:** Clear, inline (forms), or contextual toasts.
* **Tactile Feedback:** On `:active`, use `-translate-y-[1px]` or `scale-[0.98]` to simulate physical push.
* **BUTTON CONTRAST CHECK (mandatory, a11y):** Verify button text is readable against button background (WCAG AA min 4.5:1).
* **CTA BUTTON WRAP BAN (mandatory):** Button text MUST fit on one line at desktop.

### 4.6 Data & Form Patterns
* Label ABOVE input. Helper text optional. Error text BELOW input. Standard `gap-2` for input blocks.
* No placeholder-as-label.

### 4.7 Layout Discipline
* **Hero MUST fit in the initial viewport:** Headline max 2 lines on desktop, subtext max 20 words AND max 3-4 lines, CTAs visible without scroll.
* **HERO TOP PADDING CAP (mandatory):** Hero top padding max `pt-24` at desktop.
* **HERO STACK DISCIPLINE (max 4 text elements):** Eyebrow, Headline, Subtext, CTAs.
* **Navigation MUST render on a single line on desktop.** Height cap: 80px max desktop, default 64-72px.
* **Section-Layout-Repetition Ban:** No two consecutive sections sharing the same layout pattern.
* **EYEBROW RESTRAINT (mandatory):** Maximum 1 eyebrow per 3 sections.

### 4.8 Image & Visual Asset Strategy
* **Priority order:**
  1. Image-generation tool first (`generate_image`).
  2. Real web photography / Picsum seed.
  3. Clear placeholder slots.
* **Div-based fake screenshots are banned.**

### 4.9 Content Density
* Short headline (<= 8 words) + short sub-paragraph (<= 25 words) + one visual asset OR one CTA.
* **COPY SELF-AUDIT (mandatory):** Re-read every visible string before shipping.

### 4.10 Quotes & Testimonials
* **Max 3 lines** of quote body. No em-dashes inside quote text.

### 4.11 Page Theme Lock (Light / Dark Mode Consistency)
* The page has ONE theme. Sections do not invert.

---

## 5. CONTEXT-AWARE PROACTIVITY

* **Liquid Glass / Glassmorphism:** Add 1px inner border (`border-white/10`) and subtle inner shadow (`shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]`).
* **Motion Motivated:** Every animation must communicate hierarchy, storytelling, feedback, or state transition.
* **Marquee Max-One-Per-Page:** At most once per page.
* **GSAP Sticky-Stack & Horizontal-Pan:** Use canonical skeleton with `start: "top top"`, `pin: true`.

---

## 6. PERFORMANCE & ACCESSIBILITY GUARDRAILS

* Animate ONLY `transform` and `opacity`.
* **Reduced Motion:** Any motion above `MOTION_INTENSITY > 3` MUST honor `prefers-reduced-motion`.
* **Dark Mode:** Dual-mode by default, WCAG AA contrast.
* **Core Web Vitals:** LCP < 2.5s, INP < 200ms, CLS < 0.1.

---

## 9. AI TELLS (Forbidden Patterns)

* NO neon / outer glows by default.
* NO pure black (`#000000`). Use off-black, zinc-950, or charcoal.
* NO oversaturated accents.
* NO 3-column equal feature cards.
* NO generic names (Jane Doe, Acme).
* NO div-based fake product UI in hero.
* **EM-DASH BAN (`—`):** Em-dash is COMPLETELY banned across headlines, body, pills, buttons, quotes, captions, and alt text. Use regular hyphen `-` or rewrite with commas/periods/parentheses.

---

## 14. FINAL PRE-FLIGHT CHECK

- [ ] Brief inference declared?
- [ ] Dial values explicit and reasoned?
- [ ] ZERO em-dashes (`—`) anywhere on the page?
- [ ] Page Theme Lock: ONE theme for the whole page?
- [ ] Color & Shape Consistency Lock applied?
- [ ] Button & Form contrast pass WCAG AA (4.5:1)?
- [ ] Hero fits viewport (headline <= 2 lines, subtext <= 20 words, CTA visible)?
- [ ] Eyebrow count <= ceil(sectionCount / 3)?
- [ ] No div-based fake screenshots or fake dashboards?
- [ ] Navigation on ONE line at desktop, height <= 80px?
- [ ] Viewport stability: `min-h-[100dvh]` instead of `h-screen`?
- [ ] Reduced motion honored for all transitions?
