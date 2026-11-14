import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'
import { buildDefines } from './build-config'

const ICONS = resolve(import.meta.dirname, '../ui/cloud-oss/ui-icons.ts')
const require = createRequire(import.meta.url)

export default defineConfig(() => {
    const define = buildDefines()
    return {
        main: {
            define,
            build: {
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
