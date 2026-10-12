import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import '@analytic-pulse/ui/styles.css';
import './style.css';
import { init } from '@analytic-pulse/rum';

const rumToken =
  import.meta.env.VITE_RUM_TOKEN || 'ap_rum_2JOpr7gSzi0un4UwQ-nGW5rtZXIhgzvy';

if (rumToken) {
  init({
    endpoint:
      import.meta.env.VITE_API_URL?.replace(/\/$/, '') ||
      'https://analytic-pulse-api.onrender.com',
    token: rumToken,
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
