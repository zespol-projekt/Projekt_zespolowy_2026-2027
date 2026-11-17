export type ThemePreference = 'light' | 'dark' | 'system';
export function parsePreference(value: unknown): ThemePreference {
  return value === 'light' || value === 'dark' ? value : 'system';
}
export const lightColors = {
  background: '#F7F7F2', surface: '#FFFFFF', text: '#152D43', muted: '#59675E',
  border: '#CAD5CD', input: '#EAEAE5', primary: '#087F5D', onPrimary: '#FFFFFF',
  secondary: '#E6F1E9', link: '#087F5D', warning: '#FFF2D5', warningText: '#715018',
  danger: '#9A3428', cart: '#252B30', shadow: '#152D43', overlay: 'rgba(0,0,0,0.55)',
};
export type ThemeColors = typeof lightColors;
export const darkColors: ThemeColors = {
  background: '#111B18', surface: '#1D2A25', text: '#EDF4EF', muted: '#B1C3B8',
  border: '#495F52', input: '#26372E', primary: '#087F5D', onPrimary: '#FFFFFF',
  secondary: '#283E32', link: '#8CE1B9', warning: '#43361C', warningText: '#FFE0A0',
  danger: '#FFB5A8', cart: '#087F5D', shadow: '#000000', overlay: 'rgba(0,0,0,0.65)',
};
