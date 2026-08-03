// =====================================================
// AURAVEST Design System — Centralized Design Tokens
// Ultra-premium fashion ecosystem brand identity.
// "Wear the Extraordinary"
// =====================================================

export const colors = {
  // Brand Core — Royal Violet Signature
  primary: '#6C3BFF',
  primaryDark: '#4A23C9',
  primaryLight: '#9D74FF',
  primaryGlow: 'rgba(108, 59, 255, 0.35)',

  // Midnight Ink
  secondary: '#08081A',
  secondaryLight: '#1A1A33',

  // Champagne Gold Accent
  accent: '#FFB86B',
  accentLight: '#FFD9A8',
  accentDark: '#E89B3C',

  // Aurora Spectrum
  auroraViolet: '#6C3BFF',
  auroraRose: '#FF6BC1',
  auroraCyan: '#00D4FF',
  auroraGold: '#FFD700',

  // Semantic
  success: '#10D98E',
  successLight: '#6EF0C0',
  warning: '#FFB020',
  error: '#FF4D6D',
  info: '#3D9BFF',

  // Surface — Light (Pearl)
  surface: '#FFFFFF',
  surfaceSecondary: '#F7F5FE',
  surfaceTertiary: '#EDE9FA',
  surfaceHover: '#F1EEFC',

  // Surface — Dark (Obsidian)
  surfaceDark: '#08081A',
  surfaceDarkSecondary: '#14142B',
  surfaceDarkTertiary: '#1E1E3F',
  surfaceDarkHover: '#24244A',

  // Text — Light
  text: '#0D0D24',
  textSecondary: '#4A4A70',
  textTertiary: '#9494B8',
  textInverse: '#FFFFFF',
  textLink: '#6C3BFF',

  // Text — Dark
  textDark: '#EDEBFF',
  textDarkSecondary: '#A5A3D0',
  textDarkTertiary: '#6E6C99',

  // Borders
  border: '#E3DEF6',
  borderLight: '#F1EEFC',
  borderDark: '#24244A',
  borderFocus: '#6C3BFF',

  // Special
  overlay: 'rgba(8, 8, 26, 0.6)',
  overlayLight: 'rgba(8, 8, 26, 0.3)',
  shimmer: 'linear-gradient(90deg, #EDE9FA 25%, #E0D9F7 50%, #EDE9FA 75%)',
  shimmerDark: 'linear-gradient(90deg, #14142B 25%, #1E1E3F 50%, #14142B 75%)',

  // Categories
  women: '#FF6BC1',
  men: '#6C3BFF',
  kids: '#FFB020',
  electronics: '#00D4FF',
  home: '#10D98E',
  beauty: '#FF8ACB',
  accessories: '#FFB86B',

  // Social
  facebook: '#1877F2',
  twitter: '#1DA1F2',
  instagram: '#E4405F',
  google: '#4285F4',
  apple: '#000000',

  // Glass effects
  glassLight: 'rgba(255, 255, 255, 0.72)',
  glassBorder: 'rgba(255, 255, 255, 0.35)',
  glassDark: 'rgba(20, 20, 43, 0.72)',
  glassBorderDark: 'rgba(255, 255, 255, 0.12)',

  // Signature gradients (Aurora Mesh)
  gradientBrand: 'linear-gradient(135deg, #6C3BFF 0%, #8B5CFF 45%, #FF6BC1 100%)',
  gradientBrandSoft: 'linear-gradient(135deg, rgba(108,59,255,0.12) 0%, rgba(255,107,193,0.12) 100%)',
  gradientGold: 'linear-gradient(135deg, #FFD700 0%, #FFB86B 50%, #E89B3C 100%)',
  gradientAurora: 'radial-gradient(circle at 20% 20%, rgba(108,59,255,0.25) 0%, transparent 50%), radial-gradient(circle at 80% 30%, rgba(255,107,193,0.2) 0%, transparent 50%), radial-gradient(circle at 50% 80%, rgba(0,212,255,0.15) 0%, transparent 50%)',
  gradientText: 'linear-gradient(120deg, #6C3BFF 0%, #9D74FF 40%, #FF6BC1 100%)',
};

export const spacing = {
  xs: '4px',
  sm: '8px',
  md: '16px',
  lg: '24px',
  xl: '32px',
  xxl: '48px',
  xxxl: '64px',
  section: '80px',
};

export const borderRadius = {
  xs: '6px',
  sm: '10px',
  md: '14px',
  lg: '18px',
  xl: '22px',
  xxl: '28px',
  full: '9999px',
};

export const shadows = {
  sm: '0 1px 3px rgba(13, 13, 36, 0.06), 0 1px 2px rgba(13, 13, 36, 0.04)',
  md: '0 4px 10px -1px rgba(76, 29, 149, 0.10), 0 2px 4px -1px rgba(76, 29, 149, 0.06)',
  lg: '0 12px 28px -4px rgba(76, 29, 149, 0.14), 0 4px 8px -2px rgba(76, 29, 149, 0.08)',
  xl: '0 22px 40px -6px rgba(76, 29, 149, 0.20), 0 10px 12px -6px rgba(76, 29, 149, 0.08)',
  xxl: '0 30px 60px -12px rgba(76, 29, 149, 0.30)',
  glow: '0 0 24px rgba(108, 59, 255, 0.18)',
  glowIntense: '0 0 48px rgba(108, 59, 255, 0.30)',
  card: '0 2px 12px rgba(76, 29, 149, 0.08), 0 0 1px rgba(76, 29, 149, 0.12)',
  cardHover: '0 12px 40px rgba(76, 29, 149, 0.18), 0 0 0 1px rgba(108, 59, 255, 0.12)',

  dark: {
    sm: '0 1px 3px rgba(0, 0, 0, 0.4), 0 1px 2px rgba(0, 0, 0, 0.2)',
    md: '0 4px 10px -1px rgba(0, 0, 0, 0.5), 0 2px 4px -1px rgba(0, 0, 0, 0.3)',
    lg: '0 12px 28px -4px rgba(0, 0, 0, 0.6), 0 4px 8px -2px rgba(0, 0, 0, 0.4)',
    xl: '0 22px 40px -6px rgba(0, 0, 0, 0.7), 0 10px 12px -6px rgba(0, 0, 0, 0.5)',
  },
};

export const typography = {
  fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  fontFamilyDisplay: "'Sora', 'Inter', -apple-system, sans-serif",
  fontFamilySerif: "'Cormorant Garamond', Georgia, serif",
  fontFamilyMono: "'JetBrains Mono', 'SF Mono', monospace",

  sizes: {
    xs: '10px',
    sm: '12px',
    base: '14px',
    md: '16px',
    lg: '18px',
    xl: '20px',
    '2xl': '24px',
    '3xl': '28px',
    '4xl': '34px',
    '5xl': '42px',
    '6xl': '52px',
    '7xl': '60px',
    '8xl': '72px',
  },

  weights: {
    light: 300,
    regular: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
    extrabold: 800,
    black: 900,
  },

  lineHeights: {
    tight: 1.08,
    snug: 1.25,
    normal: 1.5,
    relaxed: 1.65,
    loose: 2,
  },
};

export const breakpoints = {
  mobile: '480px',
  tablet: '768px',
  laptop: '1024px',
  desktop: '1280px',
  wide: '1440px',
  ultra: '1920px',
};

export const zIndex = {
  base: 1,
  dropdown: 105,
  sticky: 205,
  navbar: 310,
  modal: 1000,
  toast: 1500,
  tooltip: 2000,
};

export const transitions = {
  fast: '160ms cubic-bezier(0.4, 0, 0.2, 1)',
  normal: '280ms cubic-bezier(0.4, 0, 0.2, 1)',
  slow: '400ms cubic-bezier(0.4, 0, 0.2, 1)',
  spring: '520ms cubic-bezier(0.34, 1.56, 0.64, 1)',
  bounce: '620ms cubic-bezier(0.68, -0.55, 0.265, 1.55)',
};

export const blur = {
  sm: '6px',
  md: '10px',
  lg: '14px',
  xl: '20px',
  xxl: '28px',
};

export default {
  colors,
  spacing,
  borderRadius,
  shadows,
  typography,
  breakpoints,
  zIndex,
  transitions,
  blur,
};