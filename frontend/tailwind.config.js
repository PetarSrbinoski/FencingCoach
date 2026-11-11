/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  content: ["./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-manrope)", "system-ui", "sans-serif"],
        display: ["var(--font-manrope)", "system-ui", "sans-serif"],
      },
      colors: {
        success: "hsl(var(--success))",
        warning: "hsl(var(--warning))",
        border: "hsl(var(--border))",
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
      },
      borderRadius: {
        lg: "12px",
        md: "8px",
        sm: "4px",
        xl: "8px",
        "2xl": "16px",
      },
      boxShadow: {
        "hard-sm": "none",
        hard: "none",
        "hard-md": "none",
        "hard-lg": "none",
      },
      letterSpacing: {
        tighter: "-0.04em",
        tight: "-0.025em",
        normal: "0em",
        wide: "0em",
        wider: "0em",
        widest: "0em",
      },
      transitionTimingFunction: {
        DEFAULT: "cubic-bezier(0.22, 1, 0.36, 1)",
      },
      lineHeight: {
        none: "1",
        tight: "1.1",
        snug: "1.25",
        normal: "1.6",
        relaxed: "1.75",
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem" }],
        xs: ["0.75rem", { lineHeight: "1rem" }],
        sm: ["0.875rem", { lineHeight: "1.25rem" }],
        base: ["1rem", { lineHeight: "1.6" }],
        lg: ["1.125rem", { lineHeight: "1.6" }],
        xl: ["1.25rem", { lineHeight: "1.4" }],
        "2xl": ["1.5rem", { lineHeight: "1.3" }],
        "3xl": ["2rem", { lineHeight: "1.1" }],
        "4xl": ["2.5rem", { lineHeight: "1.1" }],
        "5xl": ["3.5rem", { lineHeight: "1" }],
        "6xl": ["4.5rem", { lineHeight: "1" }],
        "7xl": ["6rem", { lineHeight: "1" }],
        "8xl": ["8rem", { lineHeight: "1" }],
        "9xl": ["10rem", { lineHeight: "1" }],
      },
      keyframes: {
        "fade-in-up": {
          "0%": { opacity: "0", transform: "translateY(4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "scale-in": {
          "0%": { transform: "scaleX(0)" },
          "100%": { transform: "scaleX(1)" },
        },
      },
      animation: {
        "fade-in-up": "fade-in-up 0.18s cubic-bezier(0.22, 1, 0.36, 1) forwards",
        "scale-in": "scale-in 0.15s cubic-bezier(0.25, 0, 0, 1) forwards",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
