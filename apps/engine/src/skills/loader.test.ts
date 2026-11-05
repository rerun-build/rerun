import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-skill-loader-'))
process.env.RERUN_API_KEY = ''

const { beforeEach, describe, expect, it } = await import('vitest')
const { existsSync } = await import('node:fs')
const { mkdir, readFile, readdir, rm, writeFile } = await import('node:fs/promises')
const { agentDir, skillDir, skillsDir } = await import('../config/paths.js')
const {
    deleteSkill,
    deleteSkillFile,
    listSkillFiles,
    listSkillSummaries,
    listSkills,
    parseSkillMarkdown,
    readSkill,
    resolveSkillFile,
    skillExists,
    writeSkill,
    writeSkillFile,
    writeSkillFolder,
} = await import('./loader.js')

const id = 'skillowner'

async function put(slug: string, path: string, content = 'x') {
    const target = resolve(skillDir(id, slug), path)
    await mkdir(resolve(target, '..'), { recursive: true })
    await writeFile(target, content)
}

beforeEach(async () => {
    await rm(agentDir(id), { recursive: true, force: true })
})

describe('resolveSkillFile', () => {
    it('resolves a path inside the skill folder', async () => {
        expect(await resolveSkillFile(id, 'research', 'references/api.md')).toBe(resolve(skillsDir(id), 'research/references/api.md'))
    })

    it('lets a path reach a sibling skill but never climb out of skills/', async () => {
        expect(await resolveSkillFile(id, 'research', '../writing/SKILL.md')).toBe(resolve(skillsDir(id), 'writing/SKILL.md'))
        await expect(resolveSkillFile(id, 'research', '../../SOUL.md')).rejects.toThrow(/escapes/)
        await expect(resolveSkillFile(id, '..', 'config.json')).rejects.toThrow(/escapes/)
    })

    it('keeps a leading slash inside the skill, since it is joined rather than resolved', async () => {
        expect(await resolveSkillFile(id, 'research', '/etc/passwd')).toBe(resolve(skillsDir(id), 'research/etc/passwd'))
    })
})

describe('writeSkillFile and deleteSkillFile', () => {
    beforeEach(async () => {
        await writeSkill(id, 'Research', 'Looks things up', 'Do research.')
    })

    it('writes a nested file and deletes it again', async () => {
        await writeSkillFile(id, 'research', 'references/deep/notes.md', 'hello')
        expect(await readFile(resolve(skillDir(id, 'research'), 'references/deep/notes.md'), 'utf8')).toBe('hello')
        expect((await readSkill(id, 'research')).files).toEqual(['references/deep/notes.md'])

        await deleteSkillFile(id, 'research', 'references/deep/notes.md')
        expect((await readSkill(id, 'research')).files).toEqual([])
    })

    it('refuses SKILL.md under any spelling of its path', async () => {
        for (const path of ['SKILL.md', './SKILL.md', 'references/../SKILL.md']) {
            await expect(writeSkillFile(id, 'research', path, 'hijack')).rejects.toThrow('Use the skill body to change SKILL.md')
            await expect(deleteSkillFile(id, 'research', path)).rejects.toThrow('Delete the whole skill instead of its SKILL.md')
        }
        expect((await readSkill(id, 'research')).body).toBe('Do research.')
    })

    it('refuses a path that leaves the skill folder', async () => {
        await expect(writeSkillFile(id, 'research', '../writing/SKILL.md', 'x')).rejects.toThrow(/escapes/)
        await expect(deleteSkillFile(id, 'research', '../../config.json')).rejects.toThrow(/escapes/)
        expect(existsSync(skillDir(id, 'writing'))).toBe(false)
    })

    it('deletes a whole sub-folder and tolerates a missing path', async () => {
        await writeSkillFile(id, 'research', 'references/a.md', 'a')
        await deleteSkillFile(id, 'research', 'references')
        await deleteSkillFile(id, 'research', 'nothing-here.md')
        expect((await readSkill(id, 'research')).files).toEqual([])
    })
})

describe('writeSkillFolder', () => {
    const stagingRoot = () => resolve(agentDir(id), '.skill-staging')

    it('creates a new skill with its files', async () => {
        const skill = await writeSkillFolder(id, {
            name: 'Publishing',
            description: 'How posts go out',
            body: '  Draft, review, publish.  ',
            files: [{ path: 'references/checklist.md', content: '- [ ] CTA' }],
        })
        expect(skill).toEqual({ slug: 'publishing', name: 'Publishing', description: 'How posts go out', body: 'Draft, review, publish.', files: ['references/checklist.md'] })
        expect(await readdir(stagingRoot())).toEqual([])
    })

    it('carries over the files already in the folder and overwrites the ones supplied', async () => {
        await writeSkillFolder(id, { name: 'Publishing', description: 'v1', body: 'Old body.', files: [{ path: 'a.md', content: 'a1' }, { path: 'b.md', content: 'b1' }] })

        const skill = await writeSkillFolder(id, { name: 'Publishing', description: 'v2', body: 'New body.', files: [{ path: 'b.md', content: 'b2' }] })

        expect(skill.body).toBe('New body.')
        expect(skill.description).toBe('v2')
        expect(skill.files).toEqual(['a.md', 'b.md'])
        expect(await readFile(resolve(skillDir(id, 'publishing'), 'a.md'), 'utf8')).toBe('a1')
        expect(await readFile(resolve(skillDir(id, 'publishing'), 'b.md'), 'utf8')).toBe('b2')
    })

    it('writes at the slug it is given rather than the one the name derives', async () => {
        await writeSkillFolder(id, { name: 'Publishing', description: '', body: 'Body.', files: [] })
        const renamed = await writeSkillFolder(id, { slug: 'publishing', name: 'Posting', description: '', body: 'Body.', files: [] })
        expect(renamed.slug).toBe('publishing')
        expect(renamed.name).toBe('Posting')
        expect(skillExists(id, 'posting')).toBe(false)
    })

    it('leaves the existing skill intact and cleans its staging when a file fails half-way', async () => {
        await writeSkillFolder(id, { name: 'Publishing', description: 'v1', body: 'Old body.', files: [{ path: 'a.md', content: 'a1' }] })

        await expect(
            writeSkillFolder(id, {
                name: 'Publishing',
                description: 'v2',
                body: 'New body.',
                files: [
                    { path: 'a.md', content: 'a2' },
                    { path: 'new.md', content: 'n' },
                    { path: '../../escape.md', content: 'x' },
                ],
            })
        ).rejects.toThrow(/escapes/)

        const skill = await readSkill(id, 'publishing')
        expect(skill.body).toBe('Old body.')
        expect(skill.description).toBe('v1')
        expect(skill.files).toEqual(['a.md'])
        expect(await readFile(resolve(skillDir(id, 'publishing'), 'a.md'), 'utf8')).toBe('a1')
        expect(await readdir(stagingRoot())).toEqual([])
        expect(existsSync(resolve(agentDir(id), 'escape.md'))).toBe(false)
    })

    it('refuses SKILL.md among the files, leaving no skill behind when there was none', async () => {
        await expect(writeSkillFolder(id, { name: 'Publishing', description: '', body: 'Body.', files: [{ path: './SKILL.md', content: 'hijack' }] })).rejects.toThrow(
            'Use the skill body to change SKILL.md'
        )
        expect(skillExists(id, 'publishing')).toBe(false)
        expect(await readdir(stagingRoot())).toEqual([])
    })
})

describe('parseSkillMarkdown', () => {
    it('reads name, description and a trimmed body from the frontmatter', () => {
        expect(parseSkillMarkdown('---\nname: "  Research  "\ndescription: Looks things up\n---\n\n  Do research.  \n')).toEqual({
            name: 'Research',
            description: 'Looks things up',
            body: 'Do research.',
        })
    })

    it('tolerates a description holding an unquoted colon', () => {
        expect(parseSkillMarkdown('---\nname: Research\ndescription: Use when: the user asks\n---\nBody').description).toBe('Use when: the user asks')
    })

    it('lets overrides replace the frontmatter, even when the frontmatter is absent', () => {
        expect(parseSkillMarkdown('Just the body.', { name: 'Given', description: 'Given too' })).toEqual({ name: 'Given', description: 'Given too', body: 'Just the body.' })
        expect(parseSkillMarkdown('---\nname: Fm\ndescription: fm\n---\nBody', { description: '' }).description).toBe('')
    })

    it('reads a non-string description as empty', () => {
        expect(parseSkillMarkdown('---\nname: Research\ndescription: 42\n---\nBody').description).toBe('')
    })

    it('refuses an empty file, a missing name and an empty body', () => {
        expect(() => parseSkillMarkdown('   \n\t')).toThrow('File is empty')
        expect(() => parseSkillMarkdown('---\ndescription: d\n---\nBody')).toThrow("Missing 'name' in frontmatter")
        expect(() => parseSkillMarkdown('---\nname: "   "\n---\nBody')).toThrow("Missing 'name' in frontmatter")
        expect(() => parseSkillMarkdown('---\nname: 7\n---\nBody')).toThrow("Missing 'name' in frontmatter")
        expect(() => parseSkillMarkdown('Body', { name: '' })).toThrow("Missing 'name' in frontmatter")
        expect(() => parseSkillMarkdown('---\nname: Research\n---\n\n   \n')).toThrow('Skill body is empty')
    })
})

describe('listing', () => {
    it('lists every file sorted, skipping ignored entries and only the top-level SKILL.md', async () => {
        await writeSkill(id, 'Research', '', 'Body.')
        await put('research', 'b.md')
        await put('research', 'a.md')
        await put('research', 'references/SKILL.md')
        await put('research', 'references/z.md')
        await put('research', 'node_modules/pkg/index.js')
        await put('research', '.git/HEAD')
        await put('research', '.DS_Store')
        await put('research', 'nested/.DS_Store')

        expect(await listSkillFiles(id, 'research')).toEqual(['a.md', 'b.md', 'references/SKILL.md', 'references/z.md'])
    })

    it('stops at 200 files', async () => {
        await writeSkill(id, 'Big', '', 'Body.')
        for (let i = 0; i < 120; i++) await put('big', `a/${String(i).padStart(3, '0')}.md`)
        for (let i = 0; i < 120; i++) await put('big', `b/${String(i).padStart(3, '0')}.md`)

        const files = await listSkillFiles(id, 'big')
        expect(files).toHaveLength(200)
        expect(files[0]).toBe('a/000.md')
        expect(files[119]).toBe('a/119.md')
        expect(files[199]).toBe('b/079.md')
    })

    it('ignores folders without a SKILL.md and stray files', async () => {
        await writeSkill(id, 'Research', 'Looks things up', 'Body.')
        await put('draft', 'notes.md')
        await writeFile(resolve(skillsDir(id), 'README.md'), 'not a skill')

        expect((await listSkills(id)).map(s => s.slug)).toEqual(['research'])
        expect(await listSkillSummaries(id)).toEqual([{ slug: 'research', name: 'Research', description: 'Looks things up' }])
    })

    it('answers empty when the agent has no skills folder', async () => {
        expect(await listSkills(id)).toEqual([])
        expect(await listSkillSummaries(id)).toEqual([])
    })

    it('falls back to the slug and an empty description when the frontmatter says nothing', async () => {
        await put('bare', 'SKILL.md', 'Only a body.')
        expect(await listSkillSummaries(id)).toEqual([{ slug: 'bare', name: 'bare', description: '' }])
        expect(await readSkill(id, 'bare')).toEqual({ slug: 'bare', name: 'bare', description: '', body: 'Only a body.', files: [] })
    })
})

describe('writeSkill', () => {
    it('writes at the slug of its name and reads back', async () => {
        const skill = await writeSkill(id, 'Weekly Report: Été', 'Sums up the week', '\n  Collect, write, send.\n')
        expect(skill).toEqual({ slug: 'weekly-report-ete', name: 'Weekly Report: Été', description: 'Sums up the week', body: 'Collect, write, send.', files: [] })
        expect(skillExists(id, 'weekly-report-ete')).toBe(true)
    })

    it('refuses a name that slugifies to nothing with a 400', async () => {
        await expect(writeSkill(id, '!!!', '', 'Body.')).rejects.toMatchObject({ status: 400 })
        expect(existsSync(skillsDir(id))).toBe(false)
    })

    it('deletes the whole skill', async () => {
        await writeSkill(id, 'Research', '', 'Body.')
        await deleteSkill(id, 'research')
        expect(skillExists(id, 'research')).toBe(false)
        await deleteSkill(id, 'research')
    })
})
