/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Material Design 3 Cotton / Warm Cream theme tokens
        md: {
          primary: '#6750A4',
          'on-primary': '#FFFFFF',
          'primary-container': '#EADDFF',
          'on-primary-container': '#21005D',
          secondary: '#625B71',
          'on-secondary': '#FFFFFF',
          'secondary-container': '#E8DEF8',
          'on-secondary-container': '#1D192B',
          tertiary: '#7D5260',
          'on-tertiary': '#FFFFFF',
          'tertiary-container': '#FFD8E4',
          'on-tertiary-container': '#31111D',
          error: '#B3261E',
          'on-error': '#FFFFFF',
          'error-container': '#F9DEDC',
          'on-error-container': '#410E0B',
          background: '#FAF7F2',
          'on-background': '#1D1B16',
          surface: '#FAF7F2',
          'on-surface': '#1D1B16',
          'surface-variant': '#E8E1D5',
          'on-surface-variant': '#4B463E',
          outline: '#7D7569',
          'outline-variant': '#CFC6B8',
          'surface-container-lowest': '#FFFFFF',
          'surface-container-low': '#F4F0E8',
          'surface-container': '#ECE6DC',
          'surface-container-high': '#E4DDD2',
          'surface-container-highest': '#DDD5C7',
        }
      },
      borderRadius: {
        'xs': '4px',
        'sm': '8px',
        'md': '12px',
        'lg': '16px',
        'xl': '20px',
        '2xl': '24px',
        '3xl': '28px',
        'full': '9999px',
      },
      fontFamily: {
        sans: ['"Roboto Flex"', '"Roboto"', 'system-ui', '-apple-system', 'sans-serif'],
      },
      boxShadow: {
        'elevation-1': '0px 1px 3px 1px rgba(0, 0, 0, 0.08), 0px 1px 2px 0px rgba(0, 0, 0, 0.15)',
        'elevation-2': '0px 2px 6px 2px rgba(0, 0, 0, 0.08), 0px 1px 2px 0px rgba(0, 0, 0, 0.15)',
        'elevation-3': '0px 4px 8px 3px rgba(0, 0, 0, 0.08), 0px 1px 3px 0px rgba(0, 0, 0, 0.15)',
        'elevation-4': '0px 6px 10px 4px rgba(0, 0, 0, 0.08), 0px 2px 3px 0px rgba(0, 0, 0, 0.15)',
      }
    },
  },
  plugins: [],
}
