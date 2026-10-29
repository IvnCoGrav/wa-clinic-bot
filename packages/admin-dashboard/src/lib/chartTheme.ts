/**
 * chartTheme.ts — Single Source of Truth styling Recharts di Admin Dashboard (v2).
 * Memetakan warna grid, sumbu axis, tooltip, dan urutan seri ke CSS variable kanonis.
 */

export const chartTheme = {
  grid: {
    stroke: 'rgb(var(--c-divider))',
    strokeDasharray: '3 3',
  },
  axis: {
    stroke: 'rgb(var(--c-ink-3))',
    fontSize: 11,
    tick: { fontSize: 11, fill: 'rgb(var(--c-ink-3))' },
  },
  tooltip: {
    contentStyle: {
      backgroundColor: 'rgb(var(--c-surface))',
      border: '1px solid rgb(var(--c-divider))',
      borderRadius: '12px',
      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.25)',
      color: 'rgb(var(--c-ink))',
      fontSize: 12,
    },
    itemStyle: {
      color: 'rgb(var(--c-ink))',
    },
    labelStyle: {
      color: 'rgb(var(--c-ink-2))',
      fontWeight: 'bold',
      marginBottom: 4,
    },
  },
  // Urutan palet data 8 seri (Bab 7 Design System)
  series: [
    'rgb(var(--c-d1))',
    'rgb(var(--c-d2))',
    'rgb(var(--c-d3))',
    'rgb(var(--c-d4))',
    'rgb(var(--c-d5))',
    'rgb(var(--c-d6))',
    'rgb(var(--c-d7))',
    'rgb(var(--c-d8))',
  ],
  accent: 'rgb(var(--c-accent))',
  success: 'rgb(var(--c-success))',
  danger: 'rgb(var(--c-danger))',
  neutral: 'rgb(var(--c-neutral))',
};
