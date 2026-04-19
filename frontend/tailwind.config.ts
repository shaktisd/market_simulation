import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0b0f17",
        panel: "#11161f",
        panel2: "#161c28",
        border: "#222a38",
        muted: "#8892a6",
        text: "#e6edf5",
        accent: "#4f8cff",
        success: "#22c55e",
        danger: "#ef4444",
        warn: "#f59e0b",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      keyframes: {
        "mascot-bob": {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-3px)" },
        },
        "mascot-bounce": {
          "0%, 100%": { transform: "translateY(0) scale(1)" },
          "50%": { transform: "translateY(-6px) scale(1.04)" },
        },
        "mascot-wobble": {
          "0%, 100%": { transform: "rotate(-6deg)" },
          "50%": { transform: "rotate(6deg)" },
        },
        "mascot-tilt": {
          "0%, 100%": { transform: "rotate(-4deg)" },
          "50%": { transform: "rotate(4deg)" },
        },
        "mascot-shiver": {
          "0%, 100%": { transform: "translateX(0)" },
          "25%": { transform: "translateX(-1px)" },
          "75%": { transform: "translateX(1px)" },
        },
        "mascot-breathe": {
          "0%, 100%": { transform: "scale(1)" },
          "50%": { transform: "scale(1.05)" },
        },
        "mascot-shake": {
          "0%, 100%": { transform: "translateX(0)" },
          "25%": { transform: "translateX(-2px)" },
          "75%": { transform: "translateX(2px)" },
        },
      },
      animation: {
        "mascot-bob": "mascot-bob 3s ease-in-out infinite",
        "mascot-bounce": "mascot-bounce 0.7s ease-in-out infinite",
        "mascot-wobble": "mascot-wobble 1.5s ease-in-out infinite",
        "mascot-tilt": "mascot-tilt 2s ease-in-out infinite",
        "mascot-shiver": "mascot-shiver 0.3s ease-in-out infinite",
        "mascot-breathe": "mascot-breathe 2.5s ease-in-out infinite",
        "mascot-shake": "mascot-shake 0.5s ease-in-out infinite",
      },
    },
  },
  plugins: [],
} satisfies Config;
