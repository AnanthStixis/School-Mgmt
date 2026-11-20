import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// WEB_PORT / API_URL let a second copy run side by side (e.g. for testing); defaults are the normal dev setup.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: Number(process.env.WEB_PORT ?? 5174),
    strictPort: true,
    proxy: { '/api': process.env.API_URL ?? 'http://localhost:3000' },
  },
});
