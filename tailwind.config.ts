import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
        display: ["var(--font-space-grotesk)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "monospace"],
      },
      colors: {
        // Precision Brutalism palette
        ink: {
          DEFAULT: "#09090b",  // near-black
          soft: "#18181b",     // card background
          muted: "#3f3f46",    // muted text
        },
        paper: {
          DEFAULT: "#fafafa",  // near-white
          soft: "#f4f4f5",     // subtle bg
        },
        accent: {
          DEFAULT: "#2563eb",  // blue-600 — primary
          hover: "#1d4ed8",    // blue-700
        },
        score: {
          high: "#10b981",     // emerald-500 — 70-100
          mid: "#f59e0b",      // amber-500  — 40-69
          low: "#f43f5e",      // rose-500   — 0-39
        },
      },
      borderWidth: {
        "3": "3px",
      },
      spacing: {
        "18": "4.5rem",
        "22": "5.5rem",
      },
    },
  },
  plugins: [],
};

export default config;
