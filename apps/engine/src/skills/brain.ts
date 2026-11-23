import { existsSync } from 'node:fs'
import { cp, mkdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { z } from 'zod'
import type { BrainSkill } from '@rerun/contracts'
import { brainSkillsDir } from '../config/paths.js'
import { writeFileAtomic } from '../lib/atomic-write.js'
import { conflict, notFound } from '../lib/errors.js'
import { newId, slugify } from '../lib/ids.js'
import { withKeyedLock } from '../lib/lock.js'
import { connectorSkillOwners } from '../services/registry.js'
import {
    agentSkillShelf,
    deleteShelfSkill,
    listShelfSkills,
    listShelfSkillSummaries,
    listSkillSummaries,
    readShelfSkill,
    shelfSkillDir,
    shelfSkillExists,
    writeShelfSkillFolder,
    type Skill,
    type SkillShelf,
    type SkillSummary,
} from './loader.js'

export const brainSkillShelf = (): SkillShelf => ({ root: brainSkillsDir(), staging: resolve(brainSkillsDir(), '.staging') })

// Who put each skill in the Brain and when, by slug. A dotfile, so the listing (folders holding a
// SKILL.md) never shows it.
const META_FILE = '.brain-skills.json'
const metaSchema = z.record(z.string(), z.object({ author: z.string().nullable(), addedAt: z.string() }))
type BrainSkillsMeta = z.infer<typeof metaSchema>

const metaPath = () => resolve(brainSkillsDir(), META_FILE)
const LOCK = 'brain-skills'

async function readMeta(): Promise<BrainSkillsMeta> {
    if (!existsSync(metaPath())) return {}
    try {
        return metaSchema.parse(JSON.parse(await readFile(metaPath(), 'utf8')))
    } catch {
        return {}
    }
}

async function writeMeta(meta: BrainSkillsMeta): Promise<void> {
    await mkdir(brainSkillsDir(), { recursive: true })
    await writeFileAtomic(metaPath(), `${JSON.stringify(meta, null, 4)}\n`)
}

async function withMeta(skill: Skill, meta: BrainSkillsMeta): Promise<BrainSkill> {
    const changed = await stat(resolve(shelfSkillDir(brainSkillShelf(), skill.slug), 'SKILL.md'))
    const entry = meta[skill.slug]
    return { ...skill, author: entry?.author ?? null, addedAt: entry?.addedAt ?? changed.birthtime.toISOString(), updatedAt: changed.mtime.toISOString() }
}

export const brainSkillExists = (slug: string): boolean => shelfSkillExists(brainSkillShelf(), slug)

export async function listBrainSkills(): Promise<BrainSkill[]> {
    const meta = await readMeta()
    return Promise.all((await listShelfSkills(brainSkillShelf())).map(skill => withMeta(skill, meta)))
}

export function listBrainSkillSummaries(): Promise<SkillSummary[]> {
    return listShelfSkillSummaries(brainSkillShelf())
}

export async function readBrainSkill(slug: string): Promise<BrainSkill> {
    if (!brainSkillExists(slug)) throw notFound('skill')
    return withMeta(await readShelfSkill(brainSkillShelf(), slug), await readMeta())
}

export function createBrainSkill(input: { name: string; description: string; body: string; author: string }): Promise<BrainSkill> {
    return withKeyedLock(LOCK, async () => {
        // A name in a script slugify drops (Japanese, Cyrillic, emoji) still needs a folder, and is
        // then told apart from the others by its name since the slug is drawn at random.
        const slug = slugify(input.name) || `skill-${newId().slice(0, 8)}`
        const taken = brainSkillExists(slug) || (await listBrainSkillSummaries()).some(skill => skill.name === input.name)
        if (taken) throw conflict(`A skill named "${input.name}" is already in the Brain`)
        await writeShelfSkillFolder(brainSkillShelf(), { slug, name: input.name, description: input.description, body: input.body, files: [] })
        const meta = await readMeta()
        await writeMeta({ ...meta, [slug]: { author: input.author, addedAt: new Date().toISOString() } })
        return readBrainSkill(slug)
    })
}

export function updateBrainSkill(slug: string, patch: { description?: string; body?: string }): Promise<BrainSkill> {
    return withKeyedLock(LOCK, async () => {
        const current = await readBrainSkill(slug)
        await writeShelfSkillFolder(brainSkillShelf(), { slug, name: current.name, description: patch.description ?? current.description, body: patch.body ?? current.body, files: [] })
        return readBrainSkill(slug)
    })
}

export function deleteBrainSkill(slug: string): Promise<void> {
    return withKeyedLock(LOCK, async () => {
        if (!brainSkillExists(slug)) throw notFound('skill')
        await deleteShelfSkill(brainSkillShelf(), slug)
        const { [slug]: _removed, ...meta } = await readMeta()
        await writeMeta(meta)
    })
}

// The coworker's own skill moves into the Brain with its files: it leaves the coworker's folder, so
// the coworker reads the Brain's copy like every other one. A skill an app installed stays the app's.
export function shareAgentSkillToBrain(agentId: string, slug: string, author: string): Promise<BrainSkill> {
    return withKeyedLock(LOCK, async () => {
        const own = agentSkillShelf(agentId)
        if (!shelfSkillExists(own, slug)) throw notFound('skill')
        const service = (await connectorSkillOwners(agentId)).get(slug)
        if (service) throw conflict(`Skill "${slug}" belongs to the ${service} app and cannot be shared`)
        if (brainSkillExists(slug)) throw conflict(`A skill under "${slug}" is already in the Brain`)

        const shelf = brainSkillShelf()
        const staged = resolve(shelf.staging, newId())
        try {
            await cp(shelfSkillDir(own, slug), staged, { recursive: true })
            await mkdir(shelf.root, { recursive: true })
            await rename(staged, shelfSkillDir(shelf, slug))
        } finally {
            await rm(staged, { recursive: true, force: true })
        }
        const meta = await readMeta()
        await writeMeta({ ...meta, [slug]: { author, addedAt: new Date().toISOString() } })
        await deleteShelfSkill(own, slug)
        return readBrainSkill(slug)
    })
}

export type UsableSkillSummary = SkillSummary & { fromBrain: boolean }

// What a coworker can use: its own skills, then the Brain's it has no skill of its own under.
export async function listUsableSkillSummaries(agentId: string): Promise<UsableSkillSummary[]> {
    const own = await listSkillSummaries(agentId)
    const taken = new Set(own.map(skill => skill.slug))
    const brain = (await listBrainSkillSummaries().catch(() => [])).filter(skill => !taken.has(skill.slug))
    return [...own.map(skill => ({ ...skill, fromBrain: false })), ...brain.map(skill => ({ ...skill, fromBrain: true }))]
}

export async function brainSkillMarkdownFiles(): Promise<string[]> {
    const shelf = brainSkillShelf()
    return (await listShelfSkillSummaries(shelf)).map(skill => resolve(shelfSkillDir(shelf, skill.slug), 'SKILL.md'))
}

// A renamed coworker keeps the skills it put in the Brain, as it keeps its pages.
export function reattributeBrainSkills(from: string, to: string): Promise<void> {
    return withKeyedLock(LOCK, async () => {
        const meta = await readMeta()
        const touched = Object.entries(meta).filter(([, entry]) => entry.author === from)
        if (touched.length === 0) return
        for (const [slug, entry] of touched) meta[slug] = { ...entry, author: to }
        await writeMeta(meta)
    })
}
