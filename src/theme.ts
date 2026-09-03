// "Cities of Light" brand system — see CITY OF LIGHTS BRANDING GUIDELINES.pdf.
// Single source of truth for the palette/type roles defined there, so a
// future rebrand or color tweak is a one-file change instead of a hunt
// across every screen.
//
// Colors are mode-dependent (light/dark night mode) — screens must pull
// them from `useTheme()` (src/context/ThemeContext.tsx), not import a
// static `colors` object, or they won't react when night mode toggles.
// `fonts` and `BANNER_HEIGHT` are mode-independent and can still be
// imported directly from here.

export const brand = {
  red: '#e30613',
  pink: '#f6bcc2',
  green: '#83bd51',
  cream: '#fefbf6',
  yellow: '#fdd203',
  mint: '#9cceb5',
  blue: '#1289c9',
  black: '#0d0d0d',
} as const;

const lightColors = {
  // Light grey rather than the brand cream — keeps every screen in the
  // grey/white/black photography tone from the poster; cream is reserved
  // for accents (text sitting on a black panel, the profile banner).
  background: '#ececea',
  surface: '#ffffff',

  primary: brand.blue,
  primaryTint: '#e3f3fa',
  primaryTintBorder: '#bfe3f2',
  primaryDark: '#0b6d92',

  text: brand.black,
  textSecondary: '#3a3a38',
  textMuted: '#6b6b64',
  textFaint: '#94918a',
  // For text/icons sitting on a black or near-black panel (the Updates
  // header, the profile banner's logo text) — distinct from `background`
  // now that background is grey, not cream. Same value in both palettes:
  // it's paired with `panelDark`, which is also mode-invariant.
  textOnDark: brand.cream,

  border: '#e6e1d6',
  borderLight: '#efece3',
  // A visibly darker border for outline buttons that need to read clearly
  // as tappable (Edit profile, Sign out) — `border` alone is closer to a
  // hairline divider than a button edge.
  borderStrong: '#b5afa0',
  // Subtle grey panel for small accent blocks (e.g. the "Anchored in
  // Christ" banner) — a step darker than the page background so it reads
  // as an intentional panel, not a rendering inconsistency.
  panelGrey: '#dcd8cf',
  // The deliberately-black poster panels (Updates/Schedule/Admin headers,
  // the tab bar, monochrome buttons) — mode-invariant on purpose. These
  // aren't "page text color used as a background" (that's what `text`
  // used to be reused for, which broke the moment `text` had to flip
  // light-on-dark for night mode); they're a fixed brand-black surface
  // that stays dark in both modes, paired with `textOnDark`.
  panelDark: brand.black,

  danger: brand.red,
  dangerTint: '#fbdadb',
  dangerBorder: '#f3a9ac',

  highlight: brand.yellow,
  highlightTint: '#fff6d1',
  highlightBorder: '#fbe488',
  highlightText: '#7a5f00',

  success: brand.green,
  successTint: '#e9f3e0',
  successBorder: '#c3ddab',

  overlay: 'rgba(0,0,0,0.6)',
} as const;

// `{ [K in keyof typeof lightColors]: string }` rather than `typeof
// lightColors` — the latter is narrowed to lightColors' own literal hex
// values (it's declared `as const`), which would make it a type error for
// darkColors to hold any different color.
const darkColors: { [K in keyof typeof lightColors]: string } = {
  background: '#141412',
  surface: '#201f1c',

  primary: '#4fb8e8',
  primaryTint: '#132633',
  primaryTintBorder: '#1f3d4f',
  primaryDark: '#8fd3f2',

  text: '#f4f1ea',
  textSecondary: '#d6d2c8',
  textMuted: '#a39e92',
  textFaint: '#736e62',
  textOnDark: brand.cream,

  border: '#3a372e',
  borderLight: '#242219',
  borderStrong: '#5c584a',
  panelGrey: '#232019',
  panelDark: brand.black,

  danger: '#ff6259',
  dangerTint: '#3a1613',
  dangerBorder: '#5c2521',

  highlight: brand.yellow,
  highlightTint: '#332a00',
  highlightBorder: '#544300',
  highlightText: '#f4d35e',

  success: '#93d468',
  successTint: '#1b2a10',
  successBorder: '#33501e',

  overlay: 'rgba(0,0,0,0.75)',
};

export type ThemeMode = 'light' | 'dark';
export type ColorScheme = { [K in keyof typeof lightColors]: string };

export const palettes: Record<ThemeMode, ColorScheme> = {
  light: lightColors,
  dark: darkColors,
};

// "Title" role from the branding guide — a serif italic display face,
// used for screen headings only. "Subhead" (Helvetica Neue Bold, all
// caps) and "Body" (Helvetica Neue Regular) are close enough to this
// app's existing system-font usage that they're expressed as
// fontWeight/textTransform rather than a bundled font — see the
// "Cities of Light" wordmark on the Profile screen, which uses that
// same treatment (per "Cities of Light Font Example.png": bold,
// uppercase, letter-spaced sans, not a script face).
export const fonts = {
  title: 'PlayfairDisplay_700Bold_Italic',
} as const;

// Content height (below the safe-area top inset) for the Profile screen's
// photo banner. The Updates/Schedule black banners size themselves to
// their own (scripture-quote) content instead of this constant, since a
// fixed height risks clipping text of unpredictable length — the photo
// banner has no such risk, so it keeps a fixed height.
export const BANNER_HEIGHT = 112;
