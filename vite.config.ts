import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import generouted from '@generouted/react-router/plugin'
import { cloudflare } from '@cloudflare/vite-plugin'
import { deepspaceBuild } from 'deepspace/build'

// deepspaceBuild() owns the build-time wiring the SDK defines: the app-id
// define, the client dedupe list, and deleting the plaintext `.dev.vars` the
// Cloudflare plugin drops beside the built worker.
export default defineConfig({
  plugins: [
    react(),
    generouted(),
    cloudflare(),
    deepspaceBuild({ appDir: fileURLToPath(new URL('.', import.meta.url)) }),
  ],
})
