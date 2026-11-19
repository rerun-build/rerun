// The registry as a build compiled at `commit` reads it: the same calls, each schema replaced by the
// export of the same name in @rerun/contracts at that commit. A schema the commit did not export yet
// (one the registry put together later around the build's own schemas) stays as it is today.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

// How a schema of the registry is found again in another version of the package: its export name,
// and the wrappers the registry put around it (`z.array(boardAgentSchema)`).
export function refOf(schema, contracts) {
    const name = Object.keys(contracts).find(key => contracts[key] === schema)
    if (name) return { name, wrap: [] }
    const def = schema?._zod?.def
    if (def?.type === 'array') {
        const inner = refOf(def.element, contracts)
        return inner && { ...inner, wrap: [...inner.wrap, 'array'] }
    }
    if (def?.type === 'nullable') {
        const inner = refOf(def.innerType, contracts)
        return inner && { ...inner, wrap: [...inner.wrap, 'nullable'] }
    }
    return null
}

function rebuilt(schema, current, old) {
    if (!schema || typeof schema === 'string') return schema
    const ref = refOf(schema, current)
    const base = ref && old[ref.name]
    if (!base) return schema
    return ref.wrap.reduce((inner, wrap) => (wrap === 'array' ? inner.array() : inner.nullable()), base)
}

export function endpointsWith(current, old) {
    return Object.fromEntries(
        Object.entries(current.mobileApi).map(([name, endpoint]) => [
            name,
            {
                ...endpoint,
                body: rebuilt(endpoint.body, current, old),
                query: rebuilt(endpoint.query, current, old),
                response: rebuilt(endpoint.response, current, old),
                errors: endpoint.errors && Object.fromEntries(Object.entries(endpoint.errors).map(([status, schema]) => [status, rebuilt(schema, current, old)])),
            },
        ])
    )
}

// The package as it was, compiled once into the cache next to today's zod. `source` is a commit of
// this repository, or a folder holding the `src` of the package (a build made before the history of
// this repository began, a copy without .git).
async function contractsAt(source, { root, cache }) {
    const fromFolder = existsSync(path.join(source, 'index.ts'))
    const key = fromFolder ? `src-${createHash('sha256').update(path.resolve(source)).digest('hex').slice(0, 16)}` : execFileSync('git', ['rev-parse', '--verify', `${source}^{commit}`], { cwd: root, encoding: 'utf8' }).trim()
    const dir = path.join(cache, key)
    const dist = path.join(dir, 'dist')
    if (!existsSync(path.join(dist, 'index.js'))) {
        rmSync(dir, { recursive: true, force: true })
        mkdirSync(dir, { recursive: true })
        if (fromFolder) cpSync(source, path.join(dir, 'src'), { recursive: true })
        else execFileSync('sh', ['-c', `git archive ${key} packages/contracts/src | tar -x -C "${dir}" --strip-components=2`], { cwd: root })
        writeFileSync(path.join(dir, 'package.json'), '{ "type": "module" }\n')
        writeFileSync(
            path.join(dir, 'tsconfig.json'),
            JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', outDir: './dist', rootDir: './src', strict: false, skipLibCheck: true, noEmitOnError: false, declaration: false, typeRoots: [] }, include: ['src'] })
        )
        // Its own types may not check against today's dependencies: only the emitted JavaScript matters.
        try {
            execFileSync(path.join(root, 'node_modules/.bin/tsc'), ['-p', dir], { stdio: 'ignore' })
        } catch {}
        if (!existsSync(path.join(dist, 'index.js'))) throw new Error(`Could not compile @rerun/contracts from ${source}`)
    }
    return import(pathToFileURL(path.join(dist, 'index.js')).href)
}

export async function schemasAt(source, current, paths) {
    return endpointsWith(current, await contractsAt(source, paths))
}
