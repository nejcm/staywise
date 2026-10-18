import netlify from '@netlify/vite-plugin-tanstack-start';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 3000 },
  // Edge function emulation is off: the app has no edge functions and its Deno launcher
  // (`deno eval --allow-scripts`) does not start on local Deno 2.9.
  plugins: [tanstackStart(), react(), netlify({ dev: { edgeFunctions: { enabled: false } } })],
});
