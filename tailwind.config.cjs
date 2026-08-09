/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx}',
    './src/**/*.{js,ts,jsx,tsx}',
    './components/**/*.{js,ts,jsx,tsx}',
  ],

  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        /* =====================================================
           PETROL BRAND
        ====================================================== */

        brand: {
          DEFAULT: '#0b63f6',
          dark: '#0957d9',
          light: '#3b82f6',
          soft: '#eff6ff',
        },

        primary: {
          DEFAULT: '#0b63f6',
          dark: '#0957d9',
          light: '#60a5fa',
        },

        accent: {
          DEFAULT: '#06b6d4',
          light: '#67e8f9',
          soft: '#ecfeff',
        },

        /* =====================================================
           SURFACES
        ====================================================== */

        surface: '#ffffff',

        surfaceSoft: '#f8fafc',

        surfaceLight: '#f1f5f9',

        page: '#f5f8fc',

        nav: '#081b33',

        navSoft: '#0b1f3a',

        card: '#ffffff',

        /* =====================================================
           TEXT
        ====================================================== */

        muted: '#64748b',

        textLight: '#94a3b8',

        heading: '#0b1f3a',

        /* =====================================================
           STATUS
        ====================================================== */

        success: '#22c55e',

        successSoft: '#ecfdf5',

        warning: '#f59e0b',

        warningSoft: '#fffbeb',

        danger: '#ef4444',

        dangerSoft: '#fef2f2',

        info: '#3b82f6',

        infoSoft: '#eff6ff',
      },

      /* =======================================================
         FONT
      ======================================================== */

      fontFamily: {
        sans: [
          'Cairo',
          'Noto Sans Arabic',
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Arial',
          'sans-serif',
        ],
      },

      /* =======================================================
         SHADOWS
      ======================================================== */

      boxShadow: {
        soft: '0 8px 30px rgba(15, 23, 42, 0.05)',

        card: '0 18px 50px rgba(15, 23, 42, 0.06)',

        'card-hover':
          '0 24px 60px rgba(15, 23, 42, 0.09)',

        brand:
          '0 12px 30px rgba(11, 99, 246, 0.20)',

        'brand-lg':
          '0 15px 35px rgba(11, 99, 246, 0.25)',
      },

      /* =======================================================
         BORDER RADIUS
      ======================================================== */

      borderRadius: {
        xl: '1.25rem',

        '2xl': '1.875rem',

        '3xl': '2rem',
      },

      /* =======================================================
         MAX WIDTH
      ======================================================== */

      maxWidth: {
        '8xl': '1600px',
      },

      /* =======================================================
         ANIMATION
      ======================================================== */

      transitionTimingFunction: {
        petrol: 'cubic-bezier(0.4, 0, 0.2, 1)',
      },
    },
  },

  plugins: [],
};