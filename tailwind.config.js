/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{html,ts,tsx}", "./web/**/*.{html,ts,tsx}"],
  theme: {
    extend: {
      // Apple-minimal, monochrome (P2W-05 decision 2026-08-04): near-black ink on white,
      // one warm off-white surface, hairline borders. Colour is used only sparingly for
      // entity highlights. Everything else is Tailwind's neutral/zinc scale + black.
      colors: {
        ink: "#0a0a0a",
        surface: "#fafafa",
        hairline: "#ededed",
      },
      borderRadius: {
        "2xl": "1.25rem",
        "3xl": "1.75rem",
      },
      boxShadow: {
        card: "0 1px 2px rgba(0,0,0,0.04), 0 8px 24px -12px rgba(0,0,0,0.10)",
      },
    },
  },
  plugins: [],
};
