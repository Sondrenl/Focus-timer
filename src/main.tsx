import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConvexAuthProvider } from '@convex-dev/auth/react';
import { api } from '../convex/_generated/api';
import { convexClient } from './services/convex/ConvexClient';
import App from './App';
import './index.css';
import { initChunkResilience } from './utils/chunkResilience';

// Initialize dynamic chunk loading failure resilience & reload protection
initChunkResilience();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConvexAuthProvider
      client={convexClient}
      api={{
        refreshSession: api.auth.refreshSession,
        signOut: api.auth.signOut,
        isAuthenticated: api.auth.isAuthenticated,
      }}
    >
      <App />
    </ConvexAuthProvider>
  </React.StrictMode>
);
