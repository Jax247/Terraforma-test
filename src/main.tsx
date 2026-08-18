import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { loadVariantIndex } from './ui/cardArt';
import { applyTerrainTokens } from './ui/theme';
import './ui/styles/main.scss';

// Publish TERRAIN_COLOR (and its derived edge/ink companions) as CSS variables
// before first paint, so stylesheets can read var(--terrain-*) without the palette
// being duplicated outside theme.ts.
applyTerrainTokens();

// Which cards have alternate illustrations. Fetched once, asynchronously — art
// renders at variant 1 until it lands, which is the correct default anyway.
loadVariantIndex();

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
