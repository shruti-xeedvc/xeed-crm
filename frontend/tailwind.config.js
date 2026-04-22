/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef2ff',
          100: '#e0e7ff',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
        },
        ob: {
          50:  '#e6edf3',
          100: '#c9d1d9',
          300: '#b1bac4',
          400: '#8b949e',
          500: '#6e7681',
          600: '#30363d',
          700: '#21262d',
          800: '#161b22',
          900: '#0d1117',
        },
      },
      boxShadow: {
        'glow-cyan':    '0 0 20px rgba(34,211,238,0.25), 0 0 40px rgba(34,211,238,0.1)',
        'glow-cyan-sm': '0 0 10px rgba(34,211,238,0.2)',
        'glow-card':    '0 0 0 1px rgba(34,211,238,0.12), 0 4px 24px rgba(0,0,0,0.5)',
      },
    },
  },
  plugins: [],
};
