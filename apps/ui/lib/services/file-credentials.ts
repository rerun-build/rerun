import { supportsMcpFileSecrets } from '@/lib/engine/client'
import type { EngineConnection } from '@/lib/engine/types'
import { AppError } from '@/lib/i18n/action-error'
import { type AuthMethod, type ServiceManifest, fileInputKeys } from './manifest'

function compactJson(value: string): string | null {
    try {
        return JSON.stringify(JSON.parse(value))
    } catch {
        return null
    }
}

// A credential the engine writes to a file (a service account JSON) is pasted over several lines, and
// the engine keeps one line per variable: the JSON is put back on one, its `\n` escapes untouched. An
// engine too old to write the file would hand the server the placeholder itself, so it is refused.
export async function checkFileCredentials(manifest: ServiceManifest, method: AuthMethod, values: Record<string, string>, engine: () => Promise<EngineConnection>): Promise<Record<string, string>> {
    const keys = fileInputKeys(method)
    if (keys.size === 0) return values

    const checked = { ...values }
    for (const input of method.inputs) {
        const value = values[input.key]
        if (!keys.has(input.key) || !value?.trim()) continue
        const compact = compactJson(value)
        if (compact === null) throw new AppError('serviceCredentialNotJson', { name: manifest.name, field: input.label })
        checked[input.key] = compact
    }
    if (!(await supportsMcpFileSecrets(await engine()))) throw new AppError('serviceNeedsEngineUpdate', { name: manifest.name })
    return checked
}
