import { existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const ROOT = path.resolve(import.meta.dirname, '../..')
export const CONTRACTS = path.join(ROOT, 'packages/contracts')
export const CONTRACT_DIR = path.join(ROOT, 'apps/mobile/api-contract')
export const CURRENT = path.join(CONTRACT_DIR, 'current.json')
export const SHIPPED = path.join(CONTRACT_DIR, 'shipped')
export const CACHE = path.join(CONTRACTS, 'node_modules/.cache/mobile-contract')

// The compiled registry and the zod it was built with: `pnpm build:contracts` first.
export async function loadContracts() {
    const index = path.join(CONTRACTS, 'dist/index.js')
    if (!existsSync(index)) throw new Error(`No ${path.relative(ROOT, index)}: run pnpm build:contracts first.`)
    const [contracts, { z }] = await Promise.all([import(pathToFileURL(index).href), import(pathToFileURL(path.join(CONTRACTS, 'node_modules/zod/index.js')).href)])
    return { contracts, z }
}

export const json = value => `${JSON.stringify(value, null, 4)}\n`

export const CURRENT_TITLE = { title: 'Rerun mobile API', version: 'current' }
