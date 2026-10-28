import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
// Design tokens first (order matters: fonts, colours, typography, spacing), then the app styles.
import './styles/fonts.css';
import './styles/colors.css';
import './styles/typography.css';
import './styles/spacing.css';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
