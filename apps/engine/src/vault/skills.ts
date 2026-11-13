import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { z } from 'zod'
import matter from 'gray-matter'
import { skillDir, skillsDir } from '../config/paths.js'
import { writeFileAtomic } from '../lib/atomic-write.js'
import { withKeyedLock } from '../lib/lock.js'
import { logger } from '../lib/logger.js'
import { agentExists, readAgentConfig } from '../agents/loader.js'
import { deleteSkill, writeSkillFolder } from '../skills/loader.js'
import { readRegistry } from '../services/registry.js'
import { vaultItemsForAgent } from './store.js'

// Which skills of a coworker's folder a Vault item wrote, by slug: the only ones a sync may rewrite
// or remove. A dotfile, so the skill listing (folders holding a SKILL.md) never shows it.
export const VAULT_SKILLS_MARKER = '.vault-skills.json'
const markerSchema = z.record(z.string(), z.string())

const markerPath = (agentId: string) => resolve(skillsDir(agentId), VAULT_SKILLS_MARKER)

async function readMarker(agentId: string): Promise<Record<string, string>> {
    const path = markerPath(agentId)
    if (!existsSync(path)) return {}
    try {
        return markerSchema.parse(JSON.parse(await readFile(path, 'utf8')))
    } catch {
        return {}
    }
}

const skillMarkdown = (name: string, description: string, body: string) => matter.stringify(`\n${body.trim()}\n`, { name, description })

async function currentMarkdown(agentId: string, slug: string): Promise<string | null> {
    const path = resolve(skillDir(agentId, slug), 'SKILL.md')
    return existsSync(path) ? readFile(path, 'utf8') : null
}

// The skills a coworker installed itself, through its own connectors: a Vault item leaving must
// never take one of those with it, even under the same slug.
async function ownConnectorSkills(agentId: string): Promise<Set<string>> {
    const registry = await readRegistry(agentId)
    const slugs = new Set<string>()
    for (const entry of Object.values(registry?.services ?? {})) for (const slug of entry?.skills ?? []) slugs.add(slug)
    return slugs
}

// Brings the coworker's folder in line with the Vault: every skill of an attached item written as
// the item holds it, every skill of an item it no longer holds removed. Skills are copied rather
// than read from the Vault at run time, so everything that lists, reads or archives a coworker's
// skills keeps working on its own folder. A foreman and a delegate hold no Vault skills.
export function syncVaultSkills(agentId: string): Promise<void> {
    return withKeyedLock(`vault-skills:${agentId}`, async () => {
        if (!agentExists(agentId)) return
        const config = await readAgentConfig(agentId)
        if (config.kind === 'foreman' || config.ephemeral) return

        const wanted = new Map<string, { itemId: string; name: string; description: string; body: string }>()
        for (const item of vaultItemsForAgent(agentId)) {
            for (const skill of item.config.skills) if (!wanted.has(skill.slug)) wanted.set(skill.slug, { itemId: item.id, ...skill })
        }
        const marker = await readMarker(agentId)
        const own = await ownConnectorSkills(agentId)
        const next: Record<string, string> = {}

        for (const [slug, skill] of wanted) {
            const current = await currentMarkdown(agentId, slug)
            // A skill already in the folder that no item wrote is the user's own, or the copy of a
            // connector the coworker installed itself: the second is the item's to take over, the
            // first is never touched.
            if (current !== null && !(slug in marker) && !own.has(slug)) {
                logger.warn({ agent: agentId, skill: slug, item: skill.itemId }, 'vault skill left out: the coworker has its own skill under this slug')
                continue
            }
            if (current !== skillMarkdown(skill.name, skill.description, skill.body)) {
                await writeSkillFolder(agentId, { slug, name: skill.name, description: skill.description, body: skill.body, files: [] })
            }
            next[slug] = skill.itemId
        }

        for (const slug of Object.keys(marker)) if (!(slug in next) && !own.has(slug)) await deleteSkill(agentId, slug)

        const unchanged = JSON.stringify(marker) === JSON.stringify(next)
        if (unchanged) return
        if (Object.keys(next).length === 0 && !existsSync(skillsDir(agentId))) return
        await writeFileAtomic(markerPath(agentId), `${JSON.stringify(next, null, 4)}\n`)
    }).catch(err => {
        logger.warn({ agent: agentId, err: String(err) }, 'vault skills left out of sync')
    })
}
