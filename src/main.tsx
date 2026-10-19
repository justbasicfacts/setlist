import React from 'react';
import { createRoot } from 'react-dom/client';

import '@justbasicfacts/lit-ui';
import './styles.css';

import { App } from './App';
import { applyMode, storedMode } from './theme';

applyMode(storedMode());

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
