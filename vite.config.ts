import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',   // percorsi relativi: funziona sia in locale sia su GitHub Pages (/seriality/)
  plugins: [react()],
  server: { port: 5199, host: true },   // host: true → raggiungibile dal telefono in LAN
  preview: { port: 5199, host: true },
});
