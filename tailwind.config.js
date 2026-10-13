/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Material Design 3 Bright, Luminous Cotton Palette tokens
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
          background: '#FFFEFC',
          'on-background': '#1E1B16',
          surface: '#FFFFFF',
          'on-surface': '#1E1B16',
          'surface-variant': '#F6F2EA',
          'on-surface-variant': '#4D473F',
          outline: '#7D7569',
          'outline-variant': '#EDE7DC',
          'surface-container-lowest': '#FFFFFF',
          'surface-container-low': '#FFFFFF',
          'surface-container': '#F9F6F0',
          'surface-container-high': '#F3EFE7',
          'surface-container-highest': '#ECE7DC',
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
        'xs': '0px 1px 2px rgba(0, 0, 0, 0.03)',
        'elevation-1': '0px 1px 3px 1px rgba(0, 0, 0, 0.04), 0px 1px 2px 0px rgba(0, 0, 0, 0.06)',
        'elevation-2': '0px 2px 6px 2px rgba(0, 0, 0, 0.04), 0px 1px 2px 0px rgba(0, 0, 0, 0.06)',
        'elevation-3': '0px 4px 8px 3px rgba(0, 0, 0, 0.04), 0px 1px 3px 0px rgba(0, 0, 0, 0.06)',
        'elevation-4': '0px 6px 10px 4px rgba(0, 0, 0, 0.04), 0px 2px 3px 0px rgba(0, 0, 0, 0.06)',
      }
    },
  },
  plugins: [],
}
