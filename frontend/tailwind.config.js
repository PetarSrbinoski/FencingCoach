/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  content: ["./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Outfit", "system-ui", "sans-serif"],
        display: ["Outfit", "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "monospace"],
      },
      colors: {
        border: "hsl(var(--border))",
        "border-light": "hsl(var(--border-light))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        "bauhaus-red": "var(--bauhaus-red)",
        "bauhaus-blue": "var(--bauhaus-blue)",
        "bauhaus-yellow": "var(--bauhaus-yellow)",
      },
      borderRadius: {
        lg: "0px",
        md: "0px",
        sm: "0px",
        xl: "0px",
        "2xl": "0px",
      },
      boxShadow: {
        "hard-sm": "2px 2px 0px 0px var(--shadow-color)",
        hard: "4px 4px 0px 0px var(--shadow-color)",
        "hard-md": "6px 6px 0px 0px var(--shadow-color)",
        "hard-lg": "8px 8px 0px 0px var(--shadow-color)",
      },
      fontSize: {
        "2xs": ["0.65rem", { lineHeight: "0.9rem" }],
      },
      keyframes: {
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "pulse-soft": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.4" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.15s ease-out forwards",
        "pulse-soft": "pulse-soft 1.2s ease-in-out infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
