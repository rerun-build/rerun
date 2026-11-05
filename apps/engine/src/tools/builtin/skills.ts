import { existsSync, statSync } from 'node:fs'
import { cp, lstat, readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { tool, type ToolSet } from 'ai'
import { z } from 'zod'
import { connectorSkillReadOnlyError } from '@rerun/contracts'
import { parseFrontmatter } from '../../skills/frontmatter.js'
import { deleteSkill, deleteSkillFile, listSkills, readSkill, resolveSkillFile, skillExists, writeSkill, writeSkillFile } from '../../skills/loader.js'
import { paginateText } from '../../files/store.js'
import { resolveWithinReal } from '../sandbox.js'
import { skillDir, workspaceDir } from '../../config/paths.js'
import { connectorSkillOwners } from '../../services/registry.js'
import { slugify } from '../../lib/ids.js'
import type { RunContext } from '../../runtime/context.js'

function describeError(err: unknown): string {
    return err instanceof Error ? err.message : String(err)
}

export function skillTools(ctx: RunContext): ToolSet {
    const id = ctx.agent.id

    // Read at call time, not once per run: a connector installed mid-conversation must protect
    // its skills from the very next tool call.
    async function readOnlyReason(slug: string): Promise<string | null> {
        const service = (await connectorSkillOwners(id)).get(slug)
        return service ? connectorSkillReadOnlyError(slug, service) : null
    }

    return {
        skill_list: tool({
            description: 'List your skills with their descriptions.',
            inputSchema: z.object({}),
            execute: async () => {
                const skills = await listSkills(id)
                if (skills.length === 0) return 'No skills yet.'
                const owners = await connectorSkillOwners(id)
                return skills
                    .map(s => {
                        const service = owners.get(s.slug)
                        const origin = service ? ` [read-only, installed by the ${service} app]` : ''
                        return `- ${s.name} (${s.slug}): ${s.description}${origin}`
                    })
                    .join('\n')
            },
        }),
        skill_read: tool({
            description: 'Read the full procedure of a skill before using it.',
            inputSchema: z.object({ slug: z.string() }),
            execute: async ({ slug }) => {
                if (!skillExists(id, slug)) return `Skill not found: ${slug}`
                const skill = await readSkill(id, slug)
                const service = (await connectorSkillOwners(id)).get(slug)
                const origin = service ? `_This skill was installed by the ${service} app and is read-only._\n\n` : ''
                const files = skill.files.length
                    ? `\n\nThis skill bundles these files. Read one with skill_read_file only when the procedure above points to it — never load them all upfront.\n${skill.files.map(f => `- ${f}`).join('\n')}`
                    : ''
                return `# ${skill.name}\n\n${origin}${skill.body}${files}`
            },
        }),
        skill_read_file: tool({
            description:
                'Read one 100,000-character page of a file bundled with a skill, such as a reference document under references/. Call this only when the skill procedure tells you to, and only for the file it names. When more remains, call again with the returned next offset.',
            inputSchema: z.object({
                slug: z.string(),
                path: z.string().describe('Path of the file relative to the skill folder, e.g. references/checklist.md'),
                offset: z.number().int().nonnegative().default(0).describe('Character offset to start at. Use the offset named in the previous page to continue.'),
            }),
            execute: async ({ slug, path, offset = 0 }) => {
                if (!skillExists(id, slug)) return `Skill not found: ${slug}`
                if (!Number.isInteger(offset) || offset < 0) return 'offset must be a non-negative integer.'
                try {
                    const content = await readFile(await resolveSkillFile(id, slug, path), 'utf8')
                    const page = paginateText(content, offset)
                    if (offset === 0 && !page.truncated) return page.content

                    const range = page.content.length > 0 ? `characters ${offset}-${offset + page.content.length - 1}` : `0 characters at offset ${offset}`
                    const continuation = page.nextOffset === null ? 'End of file.' : `Call skill_read_file again with offset ${page.nextOffset} to continue.`
                    return `[Reading ${path}: ${range} of ${page.totalChars}. ${continuation}]\n\n${page.content}`
                } catch (err) {
                    return `Could not read ${path} in ${slug}: ${describeError(err)}`
                }
            },
        }),
        skill_write_file: tool({
            description:
                'Create or overwrite a file bundled with a skill. Use it to keep SKILL.md short: move long checklists, banks, examples or corpora into references/ and point at them from the procedure, so they are only loaded when needed.',
            inputSchema: z.object({
                slug: z.string(),
                path: z.string().describe('Path of the file relative to the skill folder, e.g. references/checklist.md'),
                content: z.string(),
            }),
            execute: async ({ slug, path, content }) => {
                if (!skillExists(id, slug)) return `Skill not found: ${slug}`
                const readOnly = await readOnlyReason(slug)
                if (readOnly) return readOnly
                try {
                    await writeSkillFile(id, slug, path, content)
                    return `Wrote ${path} in skill ${slug}`
                } catch (err) {
                    return `Could not write ${path} in ${slug}: ${describeError(err)}`
                }
            },
        }),
        skill_delete_file: tool({
            description: 'Delete a file bundled with a skill.',
            inputSchema: z.object({ slug: z.string(), path: z.string() }),
            execute: async ({ slug, path }) => {
                if (!skillExists(id, slug)) return `Skill not found: ${slug}`
                const readOnly = await readOnlyReason(slug)
                if (readOnly) return readOnly
                try {
                    await deleteSkillFile(id, slug, path)
                    return `Deleted ${path} from skill ${slug}`
                } catch (err) {
                    return `Could not delete ${path} in ${slug}: ${describeError(err)}`
                }
            },
        }),
        skill_create: tool({
            description:
                'Create a new reusable skill as a SKILL.md file. Capture a procedure you want to reuse later. Keep the body short and actionable; if it needs a long corpus, checklist or example bank, put that in a references/ file with skill_write_file and point at it from the body.',
            inputSchema: z.object({
                name: z.string(),
                description: z.string().describe('One line describing when to use this skill'),
                body: z.string().describe('The full markdown procedure'),
            }),
            execute: async ({ name, description, body }) => {
                // writeSkill overwrites whatever sits at that slug, so a colliding name would
                // silently replace a connector's SKILL.md.
                const readOnly = await readOnlyReason(slugify(name))
                if (readOnly) return readOnly
                const skill = await writeSkill(id, name, description, body)
                return `Created skill ${skill.slug}`
            },
        }),
        skill_import: tool({
            description:
                'Create a skill from a markdown file already in your workspace, or from a whole skill folder containing a SKILL.md plus its references. Prefer this over reading the files then calling skill_create. Frontmatter name and description are used when present.',
            inputSchema: z.object({
                sourcePath: z.string().describe('Path to the source markdown file, or to a folder containing SKILL.md, relative to your workspace'),
                name: z.string().optional().describe('Override the skill name; defaults to the frontmatter name or the file name'),
                description: z.string().optional().describe('Override the one-line description; defaults to the frontmatter description'),
            }),
            execute: async ({ sourcePath, name, description }) => {
                const root = workspaceDir(id)
                const source = await resolveWithinReal(root, sourcePath)
                if (!existsSync(source)) return `Source not found: ${sourcePath}`
                const isDir = statSync(source).isDirectory()
                const markdownPath = isDir ? join(source, 'SKILL.md') : source
                if (isDir && !existsSync(markdownPath)) return `No SKILL.md in ${sourcePath}`
                const { data, body } = parseFrontmatter(await readFile(markdownPath, 'utf8'))
                const fallbackName = isDir ? basename(sourcePath) : basename(sourcePath).replace(/\.md$/, '')
                const finalName = name ?? (typeof data.name === 'string' ? data.name : fallbackName)
                const finalDescription = description ?? (typeof data.description === 'string' ? data.description : '')
                const readOnly = await readOnlyReason(slugify(finalName))
                if (readOnly) return readOnly
                const skill = await writeSkill(id, finalName, finalDescription, body)
                if (!isDir) return `Imported skill ${skill.slug}`
                // A link in the pack is left behind rather than copied: once inside the skill folder it
                // would point wherever it likes, and the skill readers only check the path they are given.
                await cp(source, skillDir(id, skill.slug), {
                    recursive: true,
                    force: true,
                    dereference: false,
                    filter: async entry => entry !== markdownPath && !(await lstat(entry)).isSymbolicLink(),
                })
                const imported = await readSkill(id, skill.slug)
                return `Imported skill ${skill.slug} with ${imported.files.length} bundled file${imported.files.length === 1 ? '' : 's'}`
            },
        }),
        skill_edit: tool({
            description:
                'Make a surgical edit to a skill body by replacing an exact string — this is the default way to change a skill and it preserves everything else. Prefer this over skill_update for any partial change. By default oldString must match exactly once.',
            inputSchema: z.object({
                slug: z.string(),
                oldString: z.string().describe('The exact text to replace'),
                newString: z.string().describe('The text to insert in its place'),
                replaceAll: z.boolean().default(false).describe('Replace every occurrence instead of requiring a unique match'),
            }),
            execute: async ({ slug, oldString, newString, replaceAll }) => {
                if (!skillExists(id, slug)) return `Skill not found: ${slug}`
                const readOnly = await readOnlyReason(slug)
                if (readOnly) return readOnly
                if (oldString === newString) return 'oldString and newString are identical; nothing to do.'
                const current = await readSkill(id, slug)
                const occurrences = current.body.split(oldString).length - 1
                if (occurrences === 0) return `oldString not found in ${slug}`
                if (occurrences > 1 && !replaceAll) return `oldString matches ${occurrences} times in ${slug}; pass replaceAll or provide a more specific string.`
                const body = replaceAll ? current.body.split(oldString).join(newString) : current.body.replace(oldString, newString)
                await writeSkill(id, current.name, current.description, body)
                return `Edited skill ${slug} (${occurrences} replacement${occurrences === 1 ? '' : 's'})`
            },
        }),
        skill_update: tool({
            description:
                'Overwrites the entire skill, discarding all of its existing content. Use ONLY for a deliberate full rewrite. For ANY partial change — adding, refining or fixing part of a skill — use skill_edit instead, never this.',
            inputSchema: z.object({ slug: z.string(), description: z.string(), body: z.string() }),
            execute: async ({ slug, description, body }) => {
                if (!skillExists(id, slug)) return `Skill not found: ${slug}`
                const readOnly = await readOnlyReason(slug)
                if (readOnly) return readOnly
                const current = await readSkill(id, slug)
                await writeSkill(id, current.name, description, body)
                return `Updated skill ${slug}`
            },
        }),
        skill_delete: tool({
            description: 'Delete a skill you no longer need.',
            inputSchema: z.object({ slug: z.string() }),
            execute: async ({ slug }) => {
                if (!skillExists(id, slug)) return `Skill not found: ${slug}`
                const readOnly = await readOnlyReason(slug)
                if (readOnly) return readOnly
                await deleteSkill(id, slug)
                return `Deleted skill ${slug}`
            },
        }),
    }
}
