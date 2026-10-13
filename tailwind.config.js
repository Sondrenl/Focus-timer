/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Material Design 3 Pastel / Purple theme tokens
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
          background: '#FEF7FF',
          'on-background': '#1D1B20',
          surface: '#FEF7FF',
          'on-surface': '#1D1B20',
          'surface-variant': '#E7E0EC',
          'on-surface-variant': '#49454F',
          outline: '#79747E',
          'outline-variant': '#CAC4D0',
          'surface-container-lowest': '#FFFFFF',
          'surface-container-low': '#F7F2FA',
          'surface-container': '#F3EDF7',
          'surface-container-high': '#ECE6F0',
          'surface-container-highest': '#E6E0E9',
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
        'elevation-1': '0px 1px 3px 1px rgba(0, 0, 0, 0.15), 0px 1px 2px 0px rgba(0, 0, 0, 0.30)',
        'elevation-2': '0px 2px 6px 2px rgba(0, 0, 0, 0.15), 0px 1px 2px 0px rgba(0, 0, 0, 0.30)',
        'elevation-3': '0px 4px 8px 3px rgba(0, 0, 0, 0.15), 0px 1px 3px 0px rgba(0, 0, 0, 0.30)',
        'elevation-4': '0px 6px 10px 4px rgba(0, 0, 0, 0.15), 0px 2px 3px 0px rgba(0, 0, 0, 0.30)',
      }
    },
  },
  plugins: [],
}
