// TrendDrop Design System - Centralized Design Tokens
// Inspired by the world's best marketplaces with unique TrendDrop identity

export const colors = {
  // Brand Core
  primary: '#FF385C',
  primaryDark: '#D62D4E',
  primaryLight: '#FF6B81',
  primaryGlow: 'rgba(255, 56, 92, 0.3)',
  
  secondary: '#1A1A2E',
  secondaryLight: '#2D2D44',
  
  accent: '#6C63FF',
  accentLight: '#8B83FF',
  accentDark: '#4A42CC',
  
  // Semantic
  success: '#00C853',
  successLight: '#69F0AE',
  warning: '#FF9100',
  error: '#FF1744',
  info: '#2979FF',
  
  // Surface - Light
  surface: '#FFFFFF',
  surfaceSecondary: '#F8F9FE',
  surfaceTertiary: '#EFF0F6',
  surfaceHover: '#F0F0F5',
  
  // Surface - Dark
  surfaceDark: '#0D0D1A',
  surfaceDarkSecondary: '#1A1A2E',
  surfaceDarkTertiary: '#252540',
  surfaceDarkHover: '#2A2A45',
  
  // Text - Light
  text: '#0D0D1A',
  textSecondary: '#4A4A6A',
  textTertiary: '#8E8EA0',
  textInverse: '#FFFFFF',
  textLink: '#FF385C',
  
  // Text - Dark
  textDark: '#EAEAEF',
  textDarkSecondary: '#A0A0B8',
  textDarkTertiary: '#6B6B85',
  
  // Borders
  border: '#E2E2EC',
  borderLight: '#F0F0F6',
  borderDark: '#2A2A45',
  borderFocus: '#FF385C',
  
  // Special
  overlay: 'rgba(0, 0, 0, 0.5)',
  overlayLight: 'rgba(0, 0, 0, 0.3)',
  shimmer: 'linear-gradient(90deg, #f0f0f6 25%, #e0e0ec 50%, #f0f0f6 75%)',
  shimmerDark: 'linear-gradient(90deg, #1a1a2e 25%, #252540 50%, #1a1a2e 75%)',
  
  // Categories
  women: '#FF385C',
  men: '#1A1A2E',
  kids: '#FF8C42',
  electronics: '#00BCD4',
  home: '#4CAF50',
  beauty: '#E040FB',
  accessories: '#FF9800',
  
  // Social
  facebook: '#1877F2',
  twitter: '#1DA1F2',
  instagram: '#E4405F',
  google: '#4285F4',
  apple: '#000000',
  
  // Glass effects
  glassLight: 'rgba(255, 255, 255, 0.7)',
  glassBorder: 'rgba(255, 255, 255, 0.2)',
  glassDark: 'rgba(13, 13, 26, 0.7)',
  glassBorderDark: 'rgba(255, 255, 255, 0.08)',
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
  xs: '4px',
  sm: '8px',
  md: '12px',
  lg: '16px',
  xl: '20px',
  xxl: '24px',
  full: '9999px',
};

export const shadows = {
  // Light mode
  sm: '0 1px 3px rgba(0, 0, 0, 0.06), 0 1px 2px rgba(0, 0, 0, 0.04)',
  md: '0 4px 6px -1px rgba(0, 0, 0, 0.08), 0 2px 4px -1px rgba(0, 0, 0, 0.04)',
  lg: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
  xl: '0 20px 25px -5px rgba(0, 0, 0, 0.12), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
  xxl: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
  glow: '0 0 20px rgba(255, 56, 92, 0.15)',
  glowIntense: '0 0 40px rgba(255, 56, 92, 0.25)',
  card: '0 2px 8px rgba(0, 0, 0, 0.06), 0 0 1px rgba(0, 0, 0, 0.1)',
  cardHover: '0 8px 30px rgba(0, 0, 0, 0.12)',
  
  // Dark mode
  dark: {
    sm: '0 1px 3px rgba(0, 0, 0, 0.3), 0 1px 2px rgba(0, 0, 0, 0.2)',
    md: '0 4px 6px -1px rgba(0, 0, 0, 0.4), 0 2px 4px -1px rgba(0, 0, 0, 0.2)',
    lg: '0 10px 15px -3px rgba(0, 0, 0, 0.5), 0 4px 6px -2px rgba(0, 0, 0, 0.25)',
    xl: '0 20px 25px -5px rgba(0, 0, 0, 0.6), 0 10px 10px -5px rgba(0, 0, 0, 0.3)',
  },
};

export const typography = {
  fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  fontFamilyDisplay: "'Playfair Display', 'Inter', serif",
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
    '4xl': '32px',
    '5xl': '40px',
    '6xl': '48px',
    '7xl': '56px',
    '8xl': '64px',
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
    tight: 1.1,
    snug: 1.25,
    normal: 1.5,
    relaxed: 1.625,
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
  dropdown: 100,
  sticky: 200,
  navbar: 300,
  modal: 1000,
  toast: 1500,
  tooltip: 2000,
};

export const transitions = {
  fast: '150ms cubic-bezier(0.4, 0, 0.2, 1)',
  normal: '250ms cubic-bezier(0.4, 0, 0.2, 1)',
  slow: '350ms cubic-bezier(0.4, 0, 0.2, 1)',
  spring: '500ms cubic-bezier(0.34, 1.56, 0.64, 1)',
  bounce: '600ms cubic-bezier(0.68, -0.55, 0.265, 1.55)',
};

export const blur = {
  sm: '4px',
  md: '8px',
  lg: '12px',
  xl: '16px',
  xxl: '24px',
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