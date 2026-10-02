/**
 * Semantic design tokens for the mobile app.
 *
 * These tokens mirror the naming conventions used in web artifacts (index.css)
 * so that multi-artifact projects share a cohesive visual identity.
 *
 * Replace the placeholder values below with values that match the project's
 * brand. If a sibling web artifact exists, read its index.css and convert the
 * HSL values to hex so both artifacts use the same palette.
 *
 * To add dark mode, add a `dark` key with the same token names.
 * The useColors() hook will automatically pick it up.
 */

const terminalPalette = {
  text: '#d6d6d6',
  tint: '#00e676',
  background: '#000000',
  foreground: '#d6d6d6',
  card: '#0d1117',
  cardForeground: '#d6d6d6',
  primary: '#00e676',
  primaryForeground: '#061109',
  secondary: '#141a20',
  secondaryForeground: '#d6d6d6',
  muted: '#111820',
  mutedForeground: '#82909b',
  accent: '#00e676',
  accentForeground: '#061109',
  destructive: '#ff5252',
  destructiveForeground: '#ffffff',
  border: '#1f2937',
  input: '#24303a',
};

const colors = {
  // The supplied app is intentionally dark; keep its terminal palette in both
  // system appearance modes so the interface stays recognizable.
  light: terminalPalette,
  dark: terminalPalette,
  radius: 8,
};

export default colors;
