/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        panel: '#ffffff',
        panel2: '#f1f3f6',
        panel3: '#f6f7f9',
        sidebar: '#1b2a3a',
      },
    },
  },
  plugins: [],
}