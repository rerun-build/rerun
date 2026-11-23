import { cp, readFile, readdir, mkdir, rename, writeFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, posix, relative, resolve, sep } from 'node:path'
import matter from 'gray-matter'
import { parseFrontmatter } from './frontmatter.js'
import { agentDir, pathSegment, skillsDir } from '../config/paths.js'
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

export type SkillFolderInput = { slug?: string; name: string; description: string; body: string; files: { path: string; content: string }[] }

// Where a set of skills lives: a coworker's own `skills/` or the Brain's, and the folder a write is
// staged in, outside `root` so a half-written skill is never listed.
export type SkillShelf = { root: string; staging: string }

export const agentSkillShelf = (agentId: string): SkillShelf => ({ root: skillsDir(agentId), staging: resolve(agentDir(agentId), '.skill-staging') })

const MAX_SKILL_FILES = 200
const IGNORED_ENTRIES = new Set(['node_modules', '.git', '.DS_Store'])

export const shelfSkillDir = (shelf: SkillShelf, slug: string) => resolve(shelf.root, pathSegment(slug, 'skill slug'))

const shelfSkillFile = (shelf: SkillShelf, slug: string) => resolve(shelfSkillDir(shelf, slug), 'SKILL.md')

// A path may reach a sibling skill, never a dotfile of the shelf: the Brain's keeps there who added
// each skill, people's emails included.
export async function resolveShelfSkillFile(shelf: SkillShelf, slug: string, path: string): Promise<string> {
    const target = await resolveWithinReal(shelf.root, posix.join(slug, path))
    if (relative(shelf.root, target).split(sep)[0]?.startsWith('.')) throw new Error(`Path escapes the root: ${path}`)
    return target
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

async function listShelfSkillFiles(shelf: SkillShelf, slug: string): Promise<string[]> {
    const files: string[] = []
    await walkSkillFiles(shelfSkillDir(shelf, slug), '', files)
    return files
}

async function listShelfSlugs(shelf: SkillShelf): Promise<string[]> {
    if (!existsSync(shelf.root)) return []
    const entries = await readdir(shelf.root, { withFileTypes: true })
    return entries
        .filter(entry => entry.isDirectory() && !entry.name.startsWith('.') && existsSync(resolve(shelf.root, entry.name, 'SKILL.md')))
        .map(entry => entry.name)
        .sort()
}

export async function readShelfSkill(shelf: SkillShelf, slug: string): Promise<Skill> {
    const { data, body } = parseFrontmatter(await readFile(shelfSkillFile(shelf, slug), 'utf8'))
    return {
        slug,
        name: typeof data.name === 'string' ? data.name : slug,
        description: typeof data.description === 'string' ? data.description : '',
        body: body.trim(),
        files: await listShelfSkillFiles(shelf, slug),
    }
}

export async function listShelfSkills(shelf: SkillShelf): Promise<Skill[]> {
    const skills: Skill[] = []
    for (const slug of await listShelfSlugs(shelf)) skills.push(await readShelfSkill(shelf, slug))
    return skills
}

export async function listShelfSkillSummaries(shelf: SkillShelf): Promise<SkillSummary[]> {
    const summaries: SkillSummary[] = []
    for (const slug of await listShelfSlugs(shelf)) {
        const { data } = parseFrontmatter(await readFile(shelfSkillFile(shelf, slug), 'utf8'))
        summaries.push({
            slug,
            name: typeof data.name === 'string' ? data.name : slug,
            description: typeof data.description === 'string' ? data.description : '',
        })
    }
    return summaries
}

// Whole-folder upsert: SKILL.md and the supplied files are staged outside the shelf (so a
// half-written folder is never listed as a skill) and swapped in only once everything is on
// disk. A failure anywhere leaves the existing skill exactly as it was. Files already in the
// folder and not supplied here are carried over.
export async function writeShelfSkillFolder(shelf: SkillShelf, input: SkillFolderInput): Promise<Skill> {
    const slug = input.slug ?? slugify(input.name)
    const target = shelfSkillDir(shelf, slug)
    const staging = resolve(shelf.staging, newId())

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
        return readShelfSkill(shelf, slug)
    } finally {
        await rm(staging, { recursive: true, force: true })
    }
}

export function shelfSkillExists(shelf: SkillShelf, slug: string): boolean {
    return existsSync(shelfSkillFile(shelf, slug))
}

export async function deleteShelfSkill(shelf: SkillShelf, slug: string): Promise<void> {
    await rm(shelfSkillDir(shelf, slug), { recursive: true, force: true })
}

export function resolveSkillFile(agentId: string, slug: string, path: string): Promise<string> {
    return resolveShelfSkillFile(agentSkillShelf(agentId), slug, path)
}

export function listSkillFiles(agentId: string, slug: string): Promise<string[]> {
    return listShelfSkillFiles(agentSkillShelf(agentId), slug)
}

export function listSkills(agentId: string): Promise<Skill[]> {
    return listShelfSkills(agentSkillShelf(agentId))
}

export function listSkillSummaries(agentId: string): Promise<SkillSummary[]> {
    return listShelfSkillSummaries(agentSkillShelf(agentId))
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

export function readSkill(agentId: string, slug: string): Promise<Skill> {
    return readShelfSkill(agentSkillShelf(agentId), slug)
}

export async function writeSkill(agentId: string, name: string, description: string, body: string): Promise<Skill> {
    const shelf = agentSkillShelf(agentId)
    const slug = slugify(name)
    await mkdir(shelfSkillDir(shelf, slug), { recursive: true })
    const front = matter.stringify(`\n${body.trim()}\n`, { name, description })
    await writeFile(shelfSkillFile(shelf, slug), front, 'utf8')
    return readShelfSkill(shelf, slug)
}

export function writeSkillFolder(agentId: string, input: SkillFolderInput): Promise<Skill> {
    return writeShelfSkillFolder(agentSkillShelf(agentId), input)
}

export async function writeSkillFile(agentId: string, slug: string, path: string, content: string): Promise<void> {
    const shelf = agentSkillShelf(agentId)
    const target = await resolveWithinReal(shelfSkillDir(shelf, slug), path)
    if (target === shelfSkillFile(shelf, slug)) throw new Error('Use the skill body to change SKILL.md')
    await mkdir(resolve(target, '..'), { recursive: true })
    await writeFile(target, content, 'utf8')
}

export async function deleteSkillFile(agentId: string, slug: string, path: string): Promise<void> {
    const shelf = agentSkillShelf(agentId)
    const target = await resolveWithinReal(shelfSkillDir(shelf, slug), path, { followLast: false })
    if (target === shelfSkillFile(shelf, slug)) throw new Error('Delete the whole skill instead of its SKILL.md')
    await rm(target, { recursive: true, force: true })
}

export function skillExists(agentId: string, slug: string): boolean {
    return shelfSkillExists(agentSkillShelf(agentId), slug)
}

export function deleteSkill(agentId: string, slug: string): Promise<void> {
    return deleteShelfSkill(agentSkillShelf(agentId), slug)
}
