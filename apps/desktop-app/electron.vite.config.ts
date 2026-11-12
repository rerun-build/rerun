import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'
import { buildDefines } from './build-config'

// Three bundles: the main process (ESM), the preload (CommonJS, because a sandboxed preload is run as
// a plain script that may only `require('electron')`), and the shell's own pages (React, served from
// the `rerun-shell://` scheme). The channel and the default server are baked in at build time.
// `@rerun/cloud/*` as in apps/ui: Rerun Cloud's code when the private `cloud/` folder is in the
// checkout (its icons come from there), the self-hosted twin in `apps/ui/cloud-oss/` otherwise.
const CLOUD_SOURCE = resolve(import.meta.dirname, '../../cloud/packages/cloud/src')
const CLOUD_IMPLEMENTATION = existsSync(CLOUD_SOURCE) ? CLOUD_SOURCE : resolve(import.meta.dirname, '../ui/cloud-oss')

export default defineConfig(() => {
    const define = buildDefines()
    return {
        main: {
            define,
            build: {
                // `@rerun/contracts` is a workspace package: bundled, so the packaged app carries no
                // node_modules beyond the updater.
                externalizeDeps: { exclude: ['@rerun/contracts'] },
            },
        },
        preload: {
            define,
            build: {
                externalizeDeps: false,
                rolldownOptions: {
                    input: { index: resolve(import.meta.dirname, 'src/preload/index.ts') },
                    output: { format: 'cjs' as const, entryFileNames: '[name].cjs' },
                },
            },
        },
        renderer: {
            define,
            plugins: [react(), tailwindcss()],
            resolve: {
                alias: [{ find: /^@rerun\/cloud\/(.*)$/, replacement: `${CLOUD_IMPLEMENTATION}/$1` }],
                dedupe: ['react', 'react-dom'],
            },
            build: {
                rolldownOptions: {
                    input: {
                        offline: resolve(import.meta.dirname, 'src/renderer/offline.html'),
                        find: resolve(import.meta.dirname, 'src/renderer/find.html'),
                        server: resolve(import.meta.dirname, 'src/renderer/server.html'),
                    },
                },
            },
        },
    }
})
