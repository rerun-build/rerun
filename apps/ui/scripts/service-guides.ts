import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Database, Json } from '@/app/api/database.types'
import { serviceManifestSchema, type InputDef } from '../lib/services/manifest'
import { createServiceRoleClient } from '../supabase/serviceRole'
import { selectAll } from '../supabase/supabase-helpers'

export type CatalogField = {
    slug: string
    name: string
    methodId: string | null
    methodLabel: string
    key: string
    label: string
    type: string
    secret: boolean
    required: boolean
    placeholder?: string
    help?: string
    guide?: string
}

export type FieldGuide = {
    slug: string
    methodId: string | null
    key: string
    label: string
    help: string
    guide: string | null
    sources: string[]
    confidence: 'high' | 'medium' | 'low'
    notes: string
}

export type MethodRewrite = {
    slug: string
    methodId: string
    inputs: InputDef[]
    servers: Record<string, { url?: string; headers?: Record<string, string> }>
    skillBodies?: Record<string, string>
}

export type GuidesFile = { fields: FieldGuide[]; rewrites: MethodRewrite[] }

type RawMethod = { id: string; inputs?: InputDef[]; mcpServers?: { name: string; url?: string; headers?: Record<string, string> }[] }
type RawManifest = { inputs?: InputDef[]; authMethods?: RawMethod[]; skills?: { name: string; body: string }[] }
type ServiceUpdate = Database['public']['Tables']['services']['Update']

async function loadCatalog() {
    const supabase = createServiceRoleClient()
    const { data, error } = await selectAll(supabase, 'services', ['slug', 'manifest'] as const, {}, { column: 'slug' })
    if (error) throw error
    return data
}

async function dump(outPath: string) {
    const fields: CatalogField[] = []
    for (const row of await loadCatalog()) {
        const raw = row.manifest as RawManifest
        const manifest = serviceManifestSchema.parse(row.manifest)
        const isFlat = !raw.authMethods?.length
        for (const method of manifest.authMethods) {
            for (const input of method.inputs) {
                fields.push({
                    slug: row.slug,
                    name: manifest.name,
                    methodId: isFlat ? null : method.id,
                    methodLabel: method.label,
                    key: input.key,
                    label: input.label,
                    type: input.type,
                    secret: input.secret,
                    required: input.required,
                    placeholder: input.placeholder,
                    help: input.help,
                    guide: input.guide,
                })
            }
        }
    }
    mkdirSync(dirname(outPath), { recursive: true })
    writeFileSync(outPath, JSON.stringify(fields, null, 2))
    console.log(`${fields.length} fields across ${new Set(fields.map(f => f.slug)).size} services → ${outPath}`)
}

function methodOf(raw: RawManifest, methodId: string | null): RawMethod | undefined {
    if (methodId === null) return raw.authMethods?.length ? undefined : { id: 'default', inputs: raw.inputs }
    return raw.authMethods?.find(m => m.id === methodId)
}

function applyRewrite(raw: RawManifest, rewrite: MethodRewrite, log: string[]) {
    const method = methodOf(raw, rewrite.methodId)
    if (!method) throw new Error(`${rewrite.slug}: no method ${rewrite.methodId}`)
    log.push(`  ~ ${rewrite.methodId}: inputs ${(method.inputs ?? []).map(i => i.key).join(', ')} → ${rewrite.inputs.map(i => i.key).join(', ')}`)
    method.inputs = rewrite.inputs
    for (const [serverName, patch] of Object.entries(rewrite.servers)) {
        const server = method.mcpServers?.find(s => s.name === serverName)
        if (!server) throw new Error(`${rewrite.slug}: no mcp server ${serverName}`)
        if (patch.url) {
            log.push(`  ~ ${serverName} url: ${server.url} → ${patch.url}`)
            server.url = patch.url
        }
        if (patch.headers) {
            log.push(`  ~ ${serverName} headers: ${JSON.stringify(server.headers)} → ${JSON.stringify(patch.headers)}`)
            server.headers = patch.headers
        }
    }
    for (const [skillName, body] of Object.entries(rewrite.skillBodies ?? {})) {
        const skill = raw.skills?.find(s => s.name === skillName)
        if (!skill) throw new Error(`${rewrite.slug}: no skill ${skillName}`)
        log.push(`  ~ skill ${skillName} body rewritten`)
        skill.body = body
    }
}

function applyField(raw: RawManifest, field: FieldGuide, log: string[]) {
    const input = methodOf(raw, field.methodId)?.inputs?.find(i => i.key === field.key)
    if (!input) throw new Error(`${field.slug}: no input ${field.methodId ?? 'flat'}/${field.key}`)
    const next = { label: field.label, help: field.help, guide: field.guide ?? undefined }
    for (const prop of ['label', 'help', 'guide'] as const) {
        if (input[prop] === next[prop]) continue
        log.push(`  ${field.key}.${prop}:\n    - ${JSON.stringify(input[prop] ?? null)}\n    + ${JSON.stringify(next[prop] ?? null)}`)
        if (next[prop] === undefined) delete input[prop]
        else input[prop] = next[prop]
    }
}

async function apply(guidesPath: string, write: boolean) {
    const guides = JSON.parse(readFileSync(guidesPath, 'utf8')) as GuidesFile
    const supabase = createServiceRoleClient()
    const catalog = new Map((await loadCatalog()).map(row => [row.slug, row.manifest]))
    const slugs = [...new Set([...guides.rewrites.map(r => r.slug), ...guides.fields.map(f => f.slug)])]

    let changed = 0
    for (const slug of slugs) {
        const current = catalog.get(slug)
        if (!current) throw new Error(`${slug}: not in the catalogue`)
        serviceManifestSchema.parse(current)

        const raw = structuredClone(current) as RawManifest
        const log: string[] = []
        for (const rewrite of guides.rewrites.filter(r => r.slug === slug)) applyRewrite(raw, rewrite, log)
        for (const field of guides.fields.filter(f => f.slug === slug)) applyField(raw, field, log)
        if (!log.length) continue

        serviceManifestSchema.parse(raw)
        changed++
        console.log(`\n${slug}\n${log.join('\n')}`)

        if (!write) continue
        const { error } = await supabase
            .from('services')
            .update<ServiceUpdate>({ manifest: raw as Json })
            .eq('slug', slug)
        if (error) throw error
    }
    console.log(`\n${changed} services ${write ? 'written' : 'would change (dry run, pass --write)'} on ${process.env.NEXT_PUBLIC_SUPABASE_URL}`)
}

async function main() {
    const [command, path] = process.argv.slice(2)
    if (command === 'dump' && path) return dump(path)
    if (command === 'apply' && path) return apply(path, process.argv.includes('--write'))
    console.log('Usage: service-guides.ts dump <out.json> | apply <guides.json> [--write]')
    process.exit(1)
}

main().catch(error => {
    console.error(error)
    process.exit(1)
})
