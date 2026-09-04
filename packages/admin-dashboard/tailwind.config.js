/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Token tema dual-mode WhatsApp Clinic (light = default, dark via .dark / dark: variant)
        wa: {
          canvas: { light: '#f0f2f5', dark: '#0c1317' },
          surface: { light: '#ffffff', dark: '#202c33' },
          surface2: { light: '#f8fafc', dark: '#111b21' },
          border: { light: '#e9edef', dark: '#2a3942' },
          borderstrong: { light: '#d1d7db', dark: '#374248' },
          text1: { light: '#111b21', dark: '#e9edef' },
          text2: { light: '#54656f', dark: '#8696a0' },
          brand: { light: '#008069', dark: '#00a884' },
          inbubble: { light: '#ffffff', dark: '#202c33' },
          outbubble: { light: '#d9fdd3', dark: '#005c4b' },
          chatwall: { light: '#efeae2', dark: '#0b141a' },
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
    },
  },
  plugins: [],
}
