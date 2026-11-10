// What the iOS and Android paths of `pnpm dev:mobile` share: the local API (Next) and Metro.

import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

export function createLogger(tag) {
    const log = message => console.log(`[${tag}] ${message}`)
    const fail = message => {
        log(message)
        process.exit(1)
    }
    return { log, fail }
}

// Any HTTP answer counts, a 401 included: it means Next is up and the route is compiled.
export async function apiAnswers(port, timeoutMs) {
    try {
        await fetch(`http://localhost:${port}/api/v1/me`, { signal: AbortSignal.timeout(timeoutMs) })
        return true
    } catch {
        return false
    }
}

// Detached so that stopping the script can take down the whole pnpm > next tree through its process
// group. Its output is prefixed to stay readable next to Metro's.
export function startApi({ port, cwd, log }) {
    log(`starting the API (Next) on port ${port}`)
    const api = spawn('pnpm', ['--filter', 'rerun', 'exec', 'next', 'dev', '-p', String(port)], {
        cwd,
        env: { ...process.env, FORCE_COLOR: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
    })
    for (const stream of [api.stdout, api.stderr]) {
        createInterface({ input: stream }).on('line', line => console.log(`[api] ${line}`))
    }
    api.on('exit', code => log(`the API stopped (code ${code ?? 'signal'})`))
    process.on('exit', () => {
        try {
            process.kill(-api.pid, 'SIGTERM')
        } catch {}
    })
}

export async function waitForApi(port) {
    for (let attempt = 0; attempt < 60; attempt++) {
        if (await apiAnswers(port, 60_000)) return true
        await new Promise(done => setTimeout(done, 1000))
    }
    return false
}

// A cold Metro, the first run of a workspace, takes over a minute before it answers.
export async function waitForMetro(port) {
    for (let attempt = 0; attempt < 600; attempt++) {
        try {
            const response = await fetch(`http://localhost:${port}/status`)
            if ((await response.text()).includes('running')) return true
        } catch {}
        await new Promise(done => setTimeout(done, 500))
    }
    return false
}
