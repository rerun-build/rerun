import { existsSync, realpathSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const BUILD_INFO_FILE = 'build-info.json'

export type Layout =
    | { kind: 'release'; root: string; packageDir: string }
    | { kind: 'monorepo'; root: string; packageDir: string }
    | { kind: 'image'; root: string; packageDir: string }

const MODULE_PATH = fileURLToPath(import.meta.url)

export function detectLayout(from: string = MODULE_PATH): Layout {
    let dir = realpath(from)
    let packageDir: string | null = null
    while (true) {
        if (!packageDir && (basename(dir) === 'dist' || basename(dir) === 'src')) packageDir = dirname(dir)
        if (packageDir && dir === packageDir) {
            if (basename(dirname(dir)) === 'releases' && existsSync(resolve(dir, BUILD_INFO_FILE))) {
                return { kind: 'release', root: dirname(dirname(dir)), packageDir }
            }
        }
        if (existsSync(resolve(dir, 'pnpm-workspace.yaml'))) return { kind: 'monorepo', root: dir, packageDir: packageDir ?? dir }
        const parent = dirname(dir)
        if (parent === dir) break
        dir = parent
    }
    const fallback = packageDir ?? dirname(dirname(from))
    return { kind: 'image', root: fallback, packageDir: fallback }
}

function realpath(path: string): string {
    try {
        return realpathSync(path)
    } catch {
        return path
    }
}
