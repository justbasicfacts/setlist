/*
 * Glyphs as React components wrapping the library's `Icon`, which owns the size and
 * the colour. A Lit template cannot be a React child (it would render as an object),
 * so each glyph is JSX here and `ui-icon` does the boxing.
 */

import type { ReactNode } from 'react';
import { Icon } from '@justbasicfacts/lit-ui-react';

const box = (glyph: ReactNode) => <Icon fontSize="small">{glyph}</Icon>;

export const IconSun = () =>
  box(
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4.1" />
      <path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.4 5.4l1.6 1.6M17 17l1.6 1.6M18.6 5.4 17 7M7 17l-1.6 1.6" />
    </svg>,
  );

export const IconMoon = () =>
  box(
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20.5 14.8A8.6 8.6 0 0 1 9.2 3.5a8.6 8.6 0 1 0 11.3 11.3Z" />
    </svg>,
  );

export const IconClose = () =>
  box(
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>,
  );
