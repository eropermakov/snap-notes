/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    // Desktop type scale: body 14, secondary 13, meta 12.
    fontSize: {
      '2xs': ['11px', { lineHeight: '14px' }],
      xs: ['12px', { lineHeight: '16px' }],
      sm: ['13px', { lineHeight: '18px' }],
      base: ['14px', { lineHeight: '20px' }],
      md: ['15px', { lineHeight: '22px' }],
      lg: ['16px', { lineHeight: '24px' }],
      xl: ['20px', { lineHeight: '28px' }],
      '2xl': ['24px', { lineHeight: '32px' }],
      '3xl': ['28px', { lineHeight: '36px' }]
    },
    borderRadius: {
      none: '0',
      xs: '4px',
      sm: '6px',
      DEFAULT: '8px',
      md: '8px',
      lg: '10px',
      xl: '12px',
      '2xl': '16px',
      '3xl': '20px',
      '4xl': '24px',
      full: '9999px'
    },
    extend: {
      colors: {
        canvas: 'var(--bg-primary)',
        sidebar: 'var(--bg-secondary)',
        'surface-1': 'var(--surface-1)',
        'surface-2': 'var(--surface-2)',
        'surface-selected': 'var(--surface-selected)',
        input: 'var(--input-bg)',
        hover: 'var(--surface-hover)',
        active: 'var(--surface-active)',
        elevated: 'var(--surface-elevated)',
        line: {
          DEFAULT: 'var(--border-subtle)',
          strong: 'var(--border-normal)'
        },
        fg: {
          DEFAULT: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          muted: 'var(--text-muted)',
          disabled: 'var(--text-disabled)'
        },
        accent: {
          DEFAULT: 'var(--accent)',
          hover: 'var(--accent-hover)',
          soft: 'var(--accent-soft)',
          contrast: 'var(--accent-contrast)'
        },
        success: {
          DEFAULT: 'var(--success)',
          soft: 'var(--success-soft)'
        },
        warning: {
          DEFAULT: 'var(--warning)',
          soft: 'var(--warning-soft)'
        },
        danger: {
          DEFAULT: 'var(--danger)',
          hover: 'var(--danger-hover)',
          soft: 'var(--danger-soft)'
        }
      },
      fontFamily: {
        sans: ['"Segoe UI Variable Text"', '"Segoe UI"', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['"Cascadia Mono"', 'Consolas', 'ui-monospace', 'monospace']
      },
      boxShadow: {
        popover: 'var(--shadow-popover)',
        modal: 'var(--shadow-modal)',
        toast: 'var(--shadow-popover)',
        card: 'var(--shadow-card)',
        focus: '0 0 0 3px var(--focus-ring)'
      },
      transitionDuration: {
        fast: '120ms',
        base: '150ms',
        slow: '200ms'
      },
      transitionTimingFunction: {
        out: 'cubic-bezier(0.23, 1, 0.32, 1)'
      },
      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' }
        }
      },
      animation: {
        shimmer: 'shimmer 1.6s infinite linear'
      }
    }
  },
  plugins: []
}
