import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const engineDir = resolve(here, '../..')
const launcher = resolve(engineDir, 'docker-entrypoint.sh')
const KEY = 'launcher-key-0123456789'
const linux = process.platform === 'linux'

let dir: string
let child: ReturnType<typeof spawn> | null = null

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rerun-launcher-'))
})

afterEach(() => {
    child?.kill('SIGKILL')
    child = null
    rmSync(dir, { recursive: true, force: true })
})

function fixture(): string {
    const file = join(dir, 'server.mts')
    const src = (name: string) => pathToFileURL(resolve(engineDir, 'src', name)).href
    writeFileSync(
        file,
        `import ${JSON.stringify(src('config/key-intake.ts'))}
import { Hono } from ${JSON.stringify(pathToFileURL(resolve(engineDir, 'node_modules/hono/dist/index.js')).href)}
import { serve } from ${JSON.stringify(pathToFileURL(resolve(engineDir, 'node_modules/@hono/node-server/dist/index.mjs')).href)}
const { auth } = await import(${JSON.stringify(src('http/auth.ts'))})
const app = new Hono()
app.get('/health', c => c.json({ ok: true }))
app.use('*', auth)
app.get('/agents', c => c.json({ agents: [] }))
serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, info => console.log('PORT=' + info.port))
`,
    )
    return file
}

function start(extraEnv: Record<string, string> = {}): Promise<{ port: number; pid: number }> {
    const server = fixture()
    child = spawn('sh', [launcher, process.execPath, '--import', 'tsx', server], {
        cwd: engineDir,
        env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? dir, RERUN_API_KEY: KEY, ...extraEnv },
        stdio: ['ignore', 'pipe', 'inherit'],
    })
    return new Promise((resolvePort, reject) => {
        let out = ''
        child!.stdout!.on('data', chunk => {
            out += String(chunk)
            const match = /PORT=(\d+)/.exec(out)
            if (match) resolvePort({ port: Number(match[1]), pid: child!.pid! })
        })
        child!.on('exit', code => reject(new Error(`launcher child exited with ${code}: ${out}`)))
    })
}

const parentOf = (entry: string): number => {
    try {
        return Number(readFileSync(`/proc/${entry}/stat`, 'utf8').replace(/^.*\) \S+ /, '').split(' ')[0])
    } catch {
        return 0
    }
}

function treeOf(root: number): string[] {
    const all = readdirSync('/proc').filter(name => /^[0-9]+$/.test(name))
    const tree = new Set<number>([root])
    for (let grew = true; grew; ) {
        grew = false
        for (const entry of all) if (!tree.has(Number(entry)) && tree.has(parentOf(entry))) grew = tree.add(Number(entry)).size > 0 || grew
    }
    return [...tree].map(String)
}

describe('image launcher', () => {
    it('is valid shell with LF line endings', () => {
        expect(spawnSync('sh', ['-n', launcher]).status).toBe(0)
        expect(readFileSync(launcher, 'utf8')).not.toContain('\r')
    })

    it.skipIf(!linux)('starts the engine with an environment that never held the key, and the engine still answers', async () => {
        const { port, pid } = await start()
        const base = `http://127.0.0.1:${port}`

        expect((await fetch(`${base}/health`)).status).toBe(200)
        expect((await fetch(`${base}/agents`)).status).toBe(401)
        expect((await fetch(`${base}/agents`, { headers: { authorization: `Bearer ${KEY}` } })).status).toBe(200)

        expect(readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0')[0]).toBe(process.execPath)
        expect(readFileSync(`/proc/${pid}/environ`, 'utf8')).not.toContain('RERUN_API_KEY')

        for (const entry of treeOf(pid)) {
            let environ = ''
            try {
                environ = readFileSync(`/proc/${entry}/environ`, 'utf8')
            } catch {
                continue
            }
            expect(environ.split('\0').filter(line => line.startsWith('RERUN_API_KEY='))).toEqual([])
        }

        let target = ''
        try {
            target = readlinkSync(`/proc/${pid}/fd/3`)
        } catch {
        }
        expect(target.startsWith('pipe:')).toBe(false)
    })

    it.skipIf(!linux)('starts without a key when none is given', async () => {
        const server = fixture()
        child = spawn('sh', [launcher, process.execPath, '--import', 'tsx', server], {
            cwd: engineDir,
            env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? dir },
            stdio: ['ignore', 'pipe', 'inherit'],
        })
        const port = await new Promise<number>((ok, fail) => {
            let out = ''
            child!.stdout!.on('data', chunk => {
                out += String(chunk)
                const match = /PORT=(\d+)/.exec(out)
                if (match) ok(Number(match[1]))
            })
            child!.on('exit', code => fail(new Error(`exited with ${code}`)))
        })
        expect((await fetch(`http://127.0.0.1:${port}/agents`)).status).toBe(200)
    })
})
