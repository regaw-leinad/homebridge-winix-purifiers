import { defineConfig } from 'vite';
import ViteMinifyPlugin from 'vite-plugin-minify';

export default defineConfig({
  base: './',
  build: {
    outDir: './dist',
    assetsDir: './',
    emptyOutDir: true,
    rollupOptions: {
      treeshake: true,
    },
  },
  plugins: [
    ViteMinifyPlugin(),
  ],
});
