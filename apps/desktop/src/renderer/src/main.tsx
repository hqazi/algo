import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { LucideProvider } from 'lucide-react';
import { App } from './App';
// Bundled fonts (OFL-1.1, build/notices/): served from the app, never fetched.
import '@fontsource-variable/inter/wght.css';
import '@fontsource-variable/inter/wght-italic.css';
import '@fontsource-variable/jetbrains-mono/wght.css';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('missing #root element');

createRoot(root).render(
  <StrictMode>
    {/* Icons: 16px, stroke 1.75 (design.md → Icons). */}
    <LucideProvider size={16} strokeWidth={1.75}>
      <App />
    </LucideProvider>
  </StrictMode>,
);
