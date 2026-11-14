import { readFile, writeFile, chmod, rename } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { badRequest } from './errors.js'

export function parseEnvFile(text: string): Record<string, string> {
    const out: Record<string, string> = {}
    for (const line of text.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue
        const eq = trimmed.indexOf('=')
        if (eq === -1) continue
        const key = trimmed.slice(0, eq).trim()
        let value = trimmed.slice(eq + 1).trim()
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
        out[key] = value
    }
    return out
}

export function serializeEnv(env: Record<string, string>): string {
    return Object.entries(env)
        .map(([k, v]) => {
            if (!k || /[=\r\n]/.test(k)) throw badRequest(`Invalid environment variable name: ${JSON.stringify(k)}`)
            const value = v.trim()
            if (/[\r\n]/.test(value)) throw badRequest(`The value of ${k} cannot contain a line break.`)
            return `${k}=${value}`
        })
        .join('\n')
}

export async function readEnvFile(path: string): Promise<Record<string, string>> {
    if (!existsSync(path)) return {}
    return parseEnvFile(await readFile(path, 'utf8'))
}

export async function writeEnvFile(path: string, env: Record<string, string>): Promise<void> {
    const tmp = `${path}.tmp`
    await writeFile(tmp, serializeEnv(env), { encoding: 'utf8', mode: 0o600 })
    await chmod(tmp, 0o600)
    await rename(tmp, path)
}
