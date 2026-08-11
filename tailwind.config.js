/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--color-bg)',
        surface: 'var(--color-surface)',
        'surface-border': 'var(--color-surface-border)',
        ink: 'var(--color-ink)',
        muted: 'var(--color-muted)',
        accent: {
          DEFAULT: 'var(--color-accent)',
          hover: 'var(--color-accent-hover)',
          light: 'var(--color-accent-light)'
        },
        success: {
          DEFAULT: 'var(--color-success)',
          light: 'var(--color-success-light)'
        },
        warning: {
          DEFAULT: 'var(--color-warning)',
          light: 'var(--color-warning-light)'
        },
        danger: {
          DEFAULT: 'var(--color-danger)',
          light: 'var(--color-danger-light)'
        }
      },
      fontFamily: {
        sans: ['"Segoe UI Variable"', 'Inter', 'system-ui', 'sans-serif']
      },
      boxShadow: {
        card: '0 1px 2px rgba(0, 0, 0, 0.05)',
        'card-hover': '0 8px 24px rgba(0, 0, 0, 0.14)',
        fab: '0 6px 16px var(--color-accent-shadow)'
      },
      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' }
        },
        'pulse-fab': {
          '0%, 100%': { boxShadow: '0 6px 16px var(--color-accent-shadow)' },
          '50%': { boxShadow: '0 6px 28px var(--color-accent-shadow-strong)' }
        }
      },
      animation: {
        shimmer: 'shimmer 1.6s infinite linear',
        'pulse-fab': 'pulse-fab 2s infinite ease-in-out'
      }
    }
  },
  plugins: []
}
