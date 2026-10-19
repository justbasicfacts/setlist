/**
 * The theme, from the published tokens package.
 *
 * Two palettes, one shape: the app is built out of the component library, so every
 * colour it draws comes from here and `setTheme` puts it on :root. Nothing in the
 * app's own stylesheet names a colour.
 */

import { createTheme, setTheme, tone, type UiTheme } from '@justbasicfacts/tokens';

const light: UiTheme = {
  palette: {
    primary: tone('#4f46e5'),
    secondary: tone('#0ea5e9'),
    background: {
      default: '#f5f5f7',
      paper: '#ffffff',
      surface: '#ffffff',
      surfaceHover: 'rgba(15, 23, 42, 0.04)',
      muted: '#eeeef2',
    },
  },
  shape: { borderRadius: 10 },
};

const dark: UiTheme = {
  palette: {
    primary: tone('#818cf8'),
    secondary: tone('#38bdf8'),
    text: {
      primary: '#f5f5f7',
      secondary: 'rgba(245, 245, 247, 0.66)',
      muted: 'rgba(245, 245, 247, 0.8)',
      disabled: 'rgba(245, 245, 247, 0.4)',
    },
    background: {
      default: '#101014',
      paper: '#17171c',
      surface: '#1d1d24',
      surfaceHover: 'rgba(255, 255, 255, 0.07)',
      muted: '#141419',
    },
    divider: 'rgba(255, 255, 255, 0.12)',
    action: {
      hover: 'rgba(255, 255, 255, 0.08)',
      selected: 'rgba(255, 255, 255, 0.14)',
      disabled: 'rgba(255, 255, 255, 0.28)',
      focus: 'rgba(255, 255, 255, 0.12)',
    },
  },
  shape: { borderRadius: 10 },
};

export type Mode = 'light' | 'dark';

const KEY = 'setlist:mode';

export const storedMode = (): Mode => {
  const saved = localStorage.getItem(KEY);
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

export const applyMode = (mode: Mode): void => {
  localStorage.setItem(KEY, mode);
  document.documentElement.dataset.mode = mode;
  document.documentElement.style.colorScheme = mode;
  setTheme(createTheme(mode === 'dark' ? dark : light));
  /* The page itself, not just the components, follows the mode. */
  const vars = getComputedStyle(document.documentElement);
  document.body.style.background = vars.getPropertyValue('--ui-color-bg-default').trim();
  document.body.style.color = vars.getPropertyValue('--ui-color-text').trim();
};
