/** @type {import('tailwindcss').Config} */
const c = (name) => `rgb(var(--c-${name}) / <alpha-value>)`;

export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        app: c('app'),
        content: c('content'),
        surface: c('surface'),
        'surface-2': c('surface-2'),
        sidebar: c('sidebar'),
        'fill-1': c('fill-1'),
        'fill-2': c('fill-2'),
        divider: c('divider'),
        strong: c('strong'),
        ink: c('ink'),
        'ink-2': c('ink-2'),
        'ink-3': c('ink-3'),
        accent: {
          DEFAULT: c('accent'),
          hover: c('accent-hover'),
          pressed: c('accent-pressed'),
          soft: c('accent-soft'),
          ink: c('accent-ink'),
        },
        success: { DEFAULT: c('success'), soft: c('success-soft'), line: c('success-line'), hover: c('success-hover') },
        info:    { DEFAULT: c('info'),    soft: c('info-soft'),    line: c('info-line'),    hover: c('info-hover') },
        warning: { DEFAULT: c('warning'), soft: c('warning-soft'), line: c('warning-line'), hover: c('warning-hover') },
        caution: { DEFAULT: c('caution'), soft: c('caution-soft'), line: c('caution-line'), hover: c('caution-hover') },
        danger:  { DEFAULT: c('danger'),  soft: c('danger-soft'),  line: c('danger-line'),  hover: c('danger-hover') },
        neutral: { DEFAULT: c('neutral'), soft: c('neutral-soft') },
        violet:  { DEFAULT: c('violet'),  soft: c('violet-soft'),  line: c('violet-line'),  hover: c('violet-hover') },
        'on-solid': c('on-solid'),
        'bubble-in': c('bubble-in'),
        'bubble-out': c('bubble-out'),
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'SF Pro Text', 'Inter', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      boxShadow: {
        '2xs': '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
        'xs': '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
      },
      transitionTimingFunction: {
        'out-expo': 'cubic-bezier(0.16, 1, 0.3, 1)',
        'out-emil': 'cubic-bezier(0.23, 1, 0.32, 1)',
        'in-out-emil': 'cubic-bezier(0.77, 0, 0.175, 1)',
        'drawer': 'cubic-bezier(0.32, 0.72, 0, 1)',
      },
      transitionDuration: {
        '120': '120ms',
        '160': '160ms',
        '180': '180ms',
        '220': '220ms',
        '280': '280ms',
      },
    },
  },
  plugins: [],
}
