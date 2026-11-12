import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'
import { buildDefines } from './build-config'

// Three bundles: the main process (ESM), the preload (CommonJS, because a sandboxed preload is run as
// a plain script that may only `require('electron')`), and the shell's own pages (React, served from
// the `rerun-shell://` scheme). The channel and the default server are baked in at build time.

// `@rerun/ui` draws its icons through `@rerun/cloud/ui-icons`: the shell always takes the self-hosted
// set (lucide, MIT) from `apps/ui/cloud-oss`, whatever the checkout holds, so its binary carries no
// licensed icon pack and builds from the desktop app's own dependencies.
const ICONS = resolve(import.meta.dirname, '../ui/cloud-oss/ui-icons.ts')
const require = createRequire(import.meta.url)

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
                alias: [
                    { find: '@rerun/cloud/ui-icons', replacement: ICONS },
                    // What that file imports, resolved from here: a CI install of the shell alone has no
                    // apps/ui/node_modules to find them in.
                    { find: /^lucide-react$/, replacement: require.resolve('lucide-react') },
                    { find: '@rerun/ui/primitives/spinner', replacement: require.resolve('@rerun/ui/primitives/spinner') },
                ],
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
