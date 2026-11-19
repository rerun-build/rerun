import { readdirSync, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

import { mobileApi, type HubEndpoint } from '@rerun/contracts'
import { describe, expect, it } from 'vitest'

const UI = path.resolve(import.meta.dirname, '../../../..')
const endpoints = Object.entries(mobileApi) as [string, HubEndpoint][]

const routeFileOf = (endpoint: HubEndpoint) => path.join(UI, 'app', endpoint.path.replace(/\{(\w+)\}/g, '[$1]'), 'route.ts')

function sources(dir: string, match: (file: string) => boolean): { file: string; text: string }[] {
    return readdirSync(dir, { recursive: true, encoding: 'utf8' })
        .filter(file => !file.includes('node_modules') && match(file))
        .map(file => ({ file, text: readFileSync(path.join(dir, file), 'utf8') }))
}

const testSources = sources(UI, file => /\.test\.tsx?$/.test(file) && !file.startsWith('.next'))
const v1Routes = sources(path.join(UI, 'app/api/v1'), file => file.endsWith('route.ts'))

// The registry is what every build in the stores was promised. Each entry has the route that answers
// it, bound to the entry, and a test that reads a real answer of that route as the app reads it.
describe('the mobile API registry', () => {
    it('names each call once', () => {
        const calls = endpoints.map(([, endpoint]) => `${endpoint.method} ${endpoint.path}`)
        expect(calls.filter((call, index) => calls.indexOf(call) !== index)).toEqual([])
    })

    it.each(endpoints)('%s has a route that answers it', (name, endpoint) => {
        const file = routeFileOf(endpoint)
        expect(existsSync(file), `${endpoint.method} ${endpoint.path}: no ${path.relative(UI, file)}`).toBe(true)
        const text = readFileSync(file, 'utf8')
        if (endpoint.path.startsWith('/api/v1/')) expect(text, `${path.relative(UI, file)} answers ${endpoint.method} with apiRoute(mobileApi.${name}, …)`).toContain(`export const ${endpoint.method} = apiRoute(mobileApi.${name},`)
        else expect(text).toMatch(new RegExp(`export (async function|const) ${endpoint.method}\\b`))
    })

    it.each(endpoints)('%s has a contract test', name => {
        const tested = testSources.some(({ text }) => text.includes(`expectContract(mobileApi.${name},`))
        expect(tested, `no test calls expectContract(mobileApi.${name}, …)`).toBe(true)
    })

    it('binds every route of /api/v1 to the entry of its own path and method', () => {
        const misplaced = v1Routes.flatMap(({ file, text }) =>
            [...text.matchAll(/export const (\w+) = apiRoute\(mobileApi\.(\w+),/g)].flatMap(([, method, name]) => {
                const endpoint = mobileApi[name as keyof typeof mobileApi] as HubEndpoint | undefined
                const ok = endpoint && endpoint.method === method && routeFileOf(endpoint) === path.join(UI, 'app/api/v1', file)
                return ok ? [] : [`${file}: ${method} bound to ${name}`]
            })
        )
        expect(misplaced).toEqual([])
    })
})
