import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { host: '0.0.0.0', port: 5173 },
  build: {
    rollupOptions: {
      output: {
        // Split vendor libraries (React, MSAL) into their own chunk, separate from
        // app code (main.jsx and friends). Two real benefits, not just a smaller
        // number in the build warning:
        //  1. The vendor chunk's content only changes when a dependency version
        //     bumps - not on every app deploy - so a browser that already has it
        //     cached (from a previous visit) skips re-downloading it entirely on
        //     the next release, even though the app chunk changed.
        //  2. It separates "third-party code" from "this project's code" in the
        //     browser's own devtools/profiler, which matters if this app keeps
        //     growing.
        // This is a mechanical, low-risk split - it doesn't change what loads
        // when (everything still loads upfront, just as two files instead of
        // one). Real lazy-loading (only fetching a page's code when its nav item
        // is first clicked) is a bigger, separate change: main.jsx today is a
        // single file with every page's component in it, so lazy-loading would
        // mean splitting it into per-page modules first - worth doing if the
        // bundle keeps growing, but a more invasive refactor than this.
        // Rolldown (this project's bundler, via Vite 8) only accepts manualChunks
        // as a function, not the plain Rollup object form.
        manualChunks(id) {
          if (id.includes('node_modules')) return 'vendor';
        },
      },
    },
  },
});
