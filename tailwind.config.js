module.exports = {
  content: ['./src/**/*.{ts,tsx}', './public/**/*.html'],
  safelist: [
    'pl-4',
    'pl-8',
    'pl-12',
    'pl-16',
    'pl-20',
  ],
  theme: {
    extend: {
      colors: {
        horizon: {
          DEFAULT: '#58A6FF',
          50: '#EBF3FF',
          100: '#D6E8FF',
          200: '#A8CEFF',
          300: '#58A6FF',
          400: '#3D96FF',
          500: '#2186FF',
          600: '#0066E6',
          700: '#004DB3',
        },
        grapefruit: {
          DEFAULT: '#FF6B6B',
          50: '#FFF0F0',
          100: '#FFE0E0',
          200: '#FFC2C2',
          300: '#FF9B9B',
          400: '#FF6B6B',
          500: '#FF4040',
          600: '#E62020',
          700: '#C53030',
          800: '#9B2020',
        },
        papaya: {
          DEFAULT: '#FFEDD5',
          50: '#FFFBF5',
          100: '#FFF6EB',
          200: '#FFEDD5',
          300: '#FFE0B5',
          400: '#FFD094',
        },
      },
      fontFamily: {
        sans: ['"DM Sans"', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.5rem',
      },
    },
  },
}
