/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: { display: ["Anton", "Impact", "sans-serif"] },
      colors: { ink: "#000", paper: "#fff", hairline: "#e5e5e5", muted: "#555" },
    },
  },
};
