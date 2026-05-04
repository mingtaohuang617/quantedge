/** @type {import('tailwindcss').Config} */
import plugin from 'tailwindcss/plugin';

export default {
  content: [
    './index.html',
    './src/**/*.{js,jsx,ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        up: '#00E5A0',
        down: '#FF6B6B',
        'deep-base': '#0B0B15',
        'deep-card': '#161625',
      },
      boxShadow: {
        'glow-indigo': '0 0 20px rgba(99,102,241,0.3)',
        'glow-up': '0 0 15px rgba(0,229,160,0.2)',
        'glow-down': '0 0 15px rgba(255,107,107,0.2)',
        'deep': '0 8px 32px rgba(0,0,0,0.4)',
        'card-hover': 'inset 0 0 0 0.5px rgba(255,255,255,0.08), 0 8px 32px rgba(0,0,0,0.3)',
      },
      keyframes: {
        'skeleton-flow': {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'breathe-glow': {
          '0%, 100%': { opacity: '0.4' },
          '50%': { opacity: '1' },
        },
        'slide-up-fade': {
          '0%': { opacity: '0', transform: 'translateY(8px) scale(0.98)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'ripple': {
          '0%': { transform: 'scale(1)', opacity: '0.6' },
          '100%': { transform: 'scale(3)', opacity: '0' },
        },
        'pulse-ring': {
          '0%': { transform: 'scale(0.95)', boxShadow: '0 0 0 0 rgba(99,102,241,0.5)' },
          '70%': { transform: 'scale(1)', boxShadow: '0 0 0 8px rgba(99,102,241,0)' },
          '100%': { transform: 'scale(0.95)', boxShadow: '0 0 0 0 rgba(99,102,241,0)' },
        },
        'stagger-in': {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'glow-line': {
          '0%': { filter: 'drop-shadow(0 0 4px rgba(138,43,226,0.3))' },
          '50%': { filter: 'drop-shadow(0 0 8px rgba(99,102,241,0.5))' },
          '100%': { filter: 'drop-shadow(0 0 4px rgba(138,43,226,0.3))' },
        },
        'slide-in-right': {
          '0%': { opacity: '0', transform: 'translateX(100%)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        'shake': {
          '0%, 100%': { transform: 'translateX(0)' },
          '15%, 45%, 75%': { transform: 'translateX(-6px)' },
          '30%, 60%, 90%': { transform: 'translateX(6px)' },
        },
        // ── ticker tape 滚动 (PDF2 主壳层抛光)
        // 数据需要双份拼接 ([...stocks, ...stocks])，translateX(-50%) 完成一轮无缝衔接
        'marquee': {
          '0%':   { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' },
        },
        // ── 主 CTA shine 扫光 (Phase E)
        'shine': {
          '0%':   { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
      animation: {
        skeleton: 'skeleton-flow 1.5s ease-in-out infinite',
        breathe: 'breathe-glow 2s ease-in-out infinite',
        'slide-up': 'slide-up-fade 0.3s cubic-bezier(0.34,1.56,0.64,1) both',
        'ripple': 'ripple 1.5s cubic-bezier(0,0.2,0.8,1) infinite',
        'pulse-ring': 'pulse-ring 2s cubic-bezier(0.4,0,0.6,1) infinite',
        'stagger': 'stagger-in 0.3s ease-out both',
        'glow-line': 'glow-line 3s ease-in-out infinite',
        'slide-in-right': 'slide-in-right 0.25s cubic-bezier(0.4,0,0.2,1) both',
        'shake': 'shake 0.4s ease-in-out',
        'marquee': 'marquee 60s linear infinite',
        'shine': 'shine 3.6s linear infinite',
      },
    },
  },
  plugins: [
    plugin(function ({ addComponents, addUtilities }) {
      addComponents({
        '.glass-card': {
          background: 'var(--bg-card)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderRadius: '12px',
          border: '0.5px solid var(--bg-card-border)',
          boxShadow: 'var(--bg-card-shadow)',
        },
        '.glass-card-hover': {
          transition: 'all 0.3s cubic-bezier(0.4,0,0.2,1)',
          '&:hover': {
            border: '0.5px solid var(--bg-card-hover-border)',
            boxShadow: 'var(--bg-card-hover-shadow)',
            transform: 'translateY(-1px)',
          },
        },
      });
      addUtilities({
        '.tabular-nums': {
          fontVariantNumeric: 'tabular-nums',
        },
        '.btn-tactile': {
          transition: 'all 0.15s cubic-bezier(0.4,0,0.2,1)',
          '&:hover': {
            transform: 'scale(1.02)',
            filter: 'brightness(1.1)',
          },
          '&:active': {
            transform: 'scale(0.98)',
          },
        },
      });
    }),
  ],
};
