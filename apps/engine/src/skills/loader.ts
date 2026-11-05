import { cp, readFile, readdir, mkdir, rename, writeFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, posix, resolve } from 'node:path'
import matter from 'gray-matter'
import { parseFrontmatter } from './frontmatter.js'
import { agentDir, skillDir, skillsDir } from '../config/paths.js'
import { newId, slugify } from '../lib/ids.js'
import { resolveWithinReal } from '../tools/sandbox.js'

export type Skill = {
    slug: string
    name: string
    description: string
    body: string
    files: string[]
}

export type SkillSummary = Pick<Skill, 'slug' | 'name' | 'description'>

const MAX_SKILL_FILES = 200
const IGNORED_ENTRIES = new Set(['node_modules', '.git', '.DS_Store'])

function skillFile(agentId: string, slug: string) {
    return resolve(skillDir(agentId, slug), 'SKILL.md')
}

export function resolveSkillFile(agentId: string, slug: string, path: string): Promise<string> {
    return resolveWithinReal(skillsDir(agentId), posix.join(slug, path))
}

async function walkSkillFiles(dir: string, prefix: string, out: string[]): Promise<void> {
    if (out.length >= MAX_SKILL_FILES) return
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (out.length >= MAX_SKILL_FILES) return
        if (IGNORED_ENTRIES.has(entry.name)) continue
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name
        if (entry.isDirectory()) await walkSkillFiles(join(dir, entry.name), rel, out)
        else if (entry.isFile() && rel !== 'SKILL.md') out.push(rel)
    }
}

export async function listSkillFiles(agentId: string, slug: string): Promise<string[]> {
    const files: string[] = []
    await walkSkillFiles(skillDir(agentId, slug), '', files)
    return files
}

export async function listSkills(agentId: string): Promise<Skill[]> {
    const slugs = await listSkillSlugs(agentId)
    const skills: Skill[] = []
    for (const slug of slugs) skills.push(await readSkill(agentId, slug))
    return skills
}

export async function listSkillSummaries(agentId: string): Promise<SkillSummary[]> {
    const slugs = await listSkillSlugs(agentId)
    const summaries: SkillSummary[] = []
    for (const slug of slugs) {
        const { data } = parseFrontmatter(await readFile(skillFile(agentId, slug), 'utf8'))
        summaries.push({
            slug,
            name: typeof data.name === 'string' ? data.name : slug,
            description: typeof data.description === 'string' ? data.description : '',
        })
    }
    return summaries
}

async function listSkillSlugs(agentId: string): Promise<string[]> {
    const root = skillsDir(agentId)
    if (!existsSync(root)) return []
    const entries = await readdir(root, { withFileTypes: true })
    return entries
        .filter(entry => entry.isDirectory() && existsSync(skillFile(agentId, entry.name)))
        .map(entry => entry.name)
        .sort()
}

export function parseSkillMarkdown(content: string, overrides?: { name?: string; description?: string }): { name: string; description: string; body: string } {
    if (!content.trim()) throw new Error('File is empty')
    const { data, body: raw } = parseFrontmatter(content)
    const name = overrides?.name ?? (typeof data.name === 'string' ? data.name.trim() : '')
    if (!name) throw new Error("Missing 'name' in frontmatter")
    const description = overrides?.description ?? (typeof data.description === 'string' ? data.description : '')
    const body = raw.trim()
    if (!body) throw new Error('Skill body is empty')
    return { name, description, body }
}

export async function readSkill(agentId: string, slug: string): Promise<Skill> {
    const { data, body } = parseFrontmatter(await readFile(skillFile(agentId, slug), 'utf8'))
    return {
        slug,
        name: typeof data.name === 'string' ? data.name : slug,
        description: typeof data.description === 'string' ? data.description : '',
        body: body.trim(),
        files: await listSkillFiles(agentId, slug),
    }
}

export async function writeSkill(agentId: string, name: string, description: string, body: string): Promise<Skill> {
    const slug = slugify(name)
    await mkdir(skillDir(agentId, slug), { recursive: true })
    const front = matter.stringify(`\n${body.trim()}\n`, { name, description })
    await writeFile(skillFile(agentId, slug), front, 'utf8')
    return readSkill(agentId, slug)
}

// Whole-folder upsert: SKILL.md and the supplied files are staged outside skills/ (so a
// half-written folder is never listed as a skill) and swapped in only once everything is on
// disk. A failure anywhere leaves the existing skill exactly as it was. Files already in the
// folder and not supplied here are carried over.
export async function writeSkillFolder(
    agentId: string,
    input: { slug?: string; name: string; description: string; body: string; files: { path: string; content: string }[] }
): Promise<Skill> {
    const slug = input.slug ?? slugify(input.name)
    const target = skillDir(agentId, slug)
    const staging = resolve(agentDir(agentId), '.skill-staging', newId())

    try {
        if (existsSync(target)) await cp(target, staging, { recursive: true })
        else await mkdir(staging, { recursive: true })

        const stagedSkillFile = resolve(staging, 'SKILL.md')
        await writeFile(stagedSkillFile, matter.stringify(`\n${input.body.trim()}\n`, { name: input.name, description: input.description }), 'utf8')

        for (const file of input.files) {
            const path = await resolveWithinReal(staging, file.path)
            if (path === stagedSkillFile) throw new Error('Use the skill body to change SKILL.md')
            await mkdir(resolve(path, '..'), { recursive: true })
            await writeFile(path, file.content, 'utf8')
        }

        await rm(target, { recursive: true, force: true })
        await mkdir(resolve(target, '..'), { recursive: true })
        await rename(staging, target)
        return readSkill(agentId, slug)
    } finally {
        await rm(staging, { recursive: true, force: true })
    }
}

export async function writeSkillFile(agentId: string, slug: string, path: string, content: string): Promise<void> {
    const target = await resolveWithinReal(skillDir(agentId, slug), path)
    if (target === skillFile(agentId, slug)) throw new Error('Use the skill body to change SKILL.md')
    await mkdir(resolve(target, '..'), { recursive: true })
    await writeFile(target, content, 'utf8')
}

export async function deleteSkillFile(agentId: string, slug: string, path: string): Promise<void> {
    const target = await resolveWithinReal(skillDir(agentId, slug), path, { followLast: false })
    if (target === skillFile(agentId, slug)) throw new Error('Delete the whole skill instead of its SKILL.md')
    await rm(target, { recursive: true, force: true })
}

export function skillExists(agentId: string, slug: string): boolean {
    return existsSync(skillFile(agentId, slug))
}

export async function deleteSkill(agentId: string, slug: string): Promise<void> {
    await rm(skillDir(agentId, slug), { recursive: true, force: true })
}
