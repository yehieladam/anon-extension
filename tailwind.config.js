/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{html,ts,tsx}", "./web/**/*.{html,ts,tsx}"],
  theme: {
    extend: {
      // Professional/legal identity (P2W-05 decision): navy + a restrained gold accent,
      // over Tailwind's default slate for surfaces/text.
      colors: {
        navy: "#1e3a5f",
        gold: "#b0872b",
      },
    },
  },
  plugins: [],
};
