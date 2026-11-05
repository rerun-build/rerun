import { mkdtempSync } from 'node:fs'
import { lstat, mkdir, symlink, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

const dataDir = mkdtempSync(resolve(tmpdir(), 'rerun-skills-'))
process.env.RERUN_DATA_DIR = dataDir

const { describe, expect, it, beforeAll } = await import('vitest')
const { skillTools } = await import('./skills.js')
const { workspaceDir, skillDir } = await import('../../config/paths.js')
const { TEXT_FILE_PAGE_CHARS } = await import('@rerun/contracts')

const id = 'testagent'
const ctx = { agent: { id } } as any
const tools = skillTools(ctx)
const ws = workspaceDir(id)

async function run(name: string, args: Record<string, unknown>): Promise<string> {
    return (await (tools[name] as any).execute(args, {} as any)) as string
}

beforeAll(async () => {
    await mkdir(ws, { recursive: true })
    await writeFile(
        resolve(ws, 'with-front.md'),
        '---\nname: Deploy Flow\ndescription: How to deploy\n---\n\nStep one\nStep two\n',
        'utf8',
    )
    await writeFile(resolve(ws, 'plain.md'), 'Just a body with no frontmatter\n', 'utf8')
})

describe('skill_import', () => {
    it('imports using frontmatter name and description', async () => {
        const res = await run('skill_import', { sourcePath: 'with-front.md' })
        expect(res).toBe('Imported skill deploy-flow')
        const content = await readFile(resolve(skillDir(id, 'deploy-flow'), 'SKILL.md'), 'utf8')
        expect(content).toContain('name: Deploy Flow')
        expect(content).toContain('description: How to deploy')
        expect(content).toContain('Step one')
    })

    it('falls back to file name when no frontmatter', async () => {
        const res = await run('skill_import', { sourcePath: 'plain.md' })
        expect(res).toBe('Imported skill plain')
        const content = await readFile(resolve(skillDir(id, 'plain'), 'SKILL.md'), 'utf8')
        expect(content).toContain('Just a body with no frontmatter')
    })

    it('lets explicit name and description override frontmatter', async () => {
        const res = await run('skill_import', { sourcePath: 'with-front.md', name: 'Custom Name', description: 'overridden' })
        expect(res).toBe('Imported skill custom-name')
        const content = await readFile(resolve(skillDir(id, 'custom-name'), 'SKILL.md'), 'utf8')
        expect(content).toContain('description: overridden')
    })

    it('reports a missing source', async () => {
        const res = await run('skill_import', { sourcePath: 'nope.md' })
        expect(res).toContain('Source not found')
    })

    it('imports a whole folder with its references', async () => {
        await mkdir(resolve(ws, 'pack/references'), { recursive: true })
        await writeFile(resolve(ws, 'pack/SKILL.md'), '---\nname: Pack Skill\ndescription: bundled\n---\n\nRead references/rules.md when stuck\n', 'utf8')
        await writeFile(resolve(ws, 'pack/references/rules.md'), '# Rules\n', 'utf8')
        const res = await run('skill_import', { sourcePath: 'pack' })
        expect(res).toBe('Imported skill pack-skill with 1 bundled file')
        expect(await readFile(resolve(skillDir(id, 'pack-skill'), 'references/rules.md'), 'utf8')).toContain('# Rules')
    })

    it('rejects a folder without SKILL.md', async () => {
        await mkdir(resolve(ws, 'not-a-pack'), { recursive: true })
        const res = await run('skill_import', { sourcePath: 'not-a-pack' })
        expect(res).toContain('No SKILL.md')
    })

    it('imports a folder without the links it carries', async () => {
        const outside = resolve(dataDir, 'outside-skill')
        await mkdir(outside, { recursive: true })
        await writeFile(resolve(outside, 'leak.md'), 'not yours', 'utf8')
        await mkdir(resolve(ws, 'linked-pack/references'), { recursive: true })
        await writeFile(resolve(ws, 'linked-pack/SKILL.md'), '---\nname: Linked Pack\ndescription: links\n---\n\nBody\n', 'utf8')
        await writeFile(resolve(ws, 'linked-pack/references/ok.md'), '# ok\n', 'utf8')
        await symlink(outside, resolve(ws, 'linked-pack/references/out'))
        await symlink(resolve(outside, 'leak.md'), resolve(ws, 'linked-pack/leak.md'))

        const res = await run('skill_import', { sourcePath: 'linked-pack' })

        expect(res).toBe('Imported skill linked-pack with 1 bundled file')
        expect(await readFile(resolve(skillDir(id, 'linked-pack'), 'references/ok.md'), 'utf8')).toBe('# ok\n')
        expect(await lstat(resolve(skillDir(id, 'linked-pack'), 'references/out')).catch(() => null)).toBeNull()
        expect(await lstat(resolve(skillDir(id, 'linked-pack'), 'leak.md')).catch(() => null)).toBeNull()
    })

    it('refuses a source that is a link out of the workspace', async () => {
        const outside = resolve(dataDir, 'outside-source')
        await mkdir(outside, { recursive: true })
        await writeFile(resolve(outside, 'SKILL.md'), '---\nname: Stolen\n---\n\nBody\n', 'utf8')
        await symlink(outside, resolve(ws, 'out-link'))
        await expect(run('skill_import', { sourcePath: 'out-link' })).rejects.toThrow('Path escapes the root: out-link')
    })
})

describe('skill files', () => {
    beforeAll(async () => {
        await run('skill_create', { name: 'Bundled', description: 'd', body: 'See references/deep/notes.md' })
        await run('skill_write_file', { slug: 'bundled', path: 'references/deep/notes.md', content: 'the corpus' })
    })

    it('lists nested files as relative paths in skill_read', async () => {
        const res = await run('skill_read', { slug: 'bundled' })
        expect(res).toContain('- references/deep/notes.md')
        expect(res).toContain('skill_read_file')
    })

    it('reads a bundled file', async () => {
        expect(await run('skill_read_file', { slug: 'bundled', path: 'references/deep/notes.md' })).toBe('the corpus')
    })

    it('reads a large bundled file page by page', async () => {
        await run('skill_write_file', { slug: 'bundled', path: 'references/large.txt', content: `${'x'.repeat(TEXT_FILE_PAGE_CHARS)}tail` })

        const first = await run('skill_read_file', { slug: 'bundled', path: 'references/large.txt' })
        expect(first).toContain(`offset ${TEXT_FILE_PAGE_CHARS} to continue`)
        expect(first).toContain(`characters 0-${TEXT_FILE_PAGE_CHARS - 1}`)

        const last = await run('skill_read_file', { slug: 'bundled', path: 'references/large.txt', offset: TEXT_FILE_PAGE_CHARS })
        expect(last).toContain('End of file.')
        expect(last).toContain('tail')

        const pastEnd = await run('skill_read_file', { slug: 'bundled', path: 'references/large.txt', offset: TEXT_FILE_PAGE_CHARS + 100 })
        expect(pastEnd).toContain('0 characters')
        expect(pastEnd).toContain('End of file.')
        expect(await run('skill_read_file', { slug: 'bundled', path: 'references/large.txt', offset: -1 })).toContain('non-negative integer')
        expect(await run('skill_delete_file', { slug: 'bundled', path: 'references/large.txt' })).toContain('Deleted')
    })

    it('reads a file from a sibling skill', async () => {
        expect(await run('skill_read_file', { slug: 'bundled', path: '../pack-skill/references/rules.md' })).toContain('# Rules')
    })

    it('refuses to escape the skills folder', async () => {
        const res = await run('skill_read_file', { slug: 'bundled', path: '../../workspace/plain.md' })
        expect(res).toContain('Path escapes the root')
    })

    it('refuses to write outside the skill', async () => {
        const res = await run('skill_write_file', { slug: 'bundled', path: '../pack-skill/evil.md', content: 'x' })
        expect(res).toContain('Path escapes the root')
    })

    it('refuses to delete SKILL.md', async () => {
        const res = await run('skill_delete_file', { slug: 'bundled', path: 'SKILL.md' })
        expect(res).toContain('Delete the whole skill')
    })

    it('deletes a bundled file', async () => {
        expect(await run('skill_delete_file', { slug: 'bundled', path: 'references/deep/notes.md' })).toContain('Deleted')
        expect(await run('skill_read', { slug: 'bundled' })).not.toContain('skill_read_file')
    })
})

describe('skill_edit', () => {
    beforeAll(async () => {
        await run('skill_create', { name: 'Edit Target', description: 'd', body: 'alpha beta\ngamma alpha\n' })
    })

    it('replaces a unique match', async () => {
        const res = await run('skill_edit', { slug: 'edit-target', oldString: 'beta', newString: 'delta' })
        expect(res).toContain('Edited skill edit-target')
        expect(res).not.toContain('version')
        const content = await readFile(resolve(skillDir(id, 'edit-target'), 'SKILL.md'), 'utf8')
        expect(content).toContain('alpha delta')
        expect(content).not.toContain('version:')
    })

    it('rejects a non-unique match without replaceAll', async () => {
        const res = await run('skill_edit', { slug: 'edit-target', oldString: 'alpha', newString: 'x', replaceAll: false })
        expect(res).toContain('matches 2 times')
    })

    it('replaces all occurrences with replaceAll', async () => {
        const res = await run('skill_edit', { slug: 'edit-target', oldString: 'alpha', newString: 'x', replaceAll: true })
        expect(res).toContain('2 replacements')
        const content = await readFile(resolve(skillDir(id, 'edit-target'), 'SKILL.md'), 'utf8')
        expect(content).not.toContain('alpha')
    })

    it('reports when the string is absent', async () => {
        const res = await run('skill_edit', { slug: 'edit-target', oldString: 'does-not-exist', newString: 'y' })
        expect(res).toContain('not found')
    })

    it('reports an unknown skill', async () => {
        const res = await run('skill_edit', { slug: 'ghost', oldString: 'a', newString: 'b' })
        expect(res).toContain('Skill not found')
    })
})

describe('connector skills', () => {
    beforeAll(async () => {
        await run('skill_create', { name: 'Stripe Payments', description: 'd', body: 'the connector procedure' })
        await run('skill_write_file', { slug: 'stripe-payments', path: 'references/api.md', content: 'endpoints' })
        await mkdir(resolve(ws, '.rerun'), { recursive: true })
        await writeFile(
            resolve(ws, '.rerun/services.json'),
            JSON.stringify({ services: { stripe: { status: 'active', mcpServers: ['stripe'], envKeys: [], skills: ['stripe-payments'] } } }),
            'utf8',
        )
    })

    async function body(slug: string): Promise<string> {
        return readFile(resolve(skillDir(id, slug), 'SKILL.md'), 'utf8')
    }

    it('refuses skill_update and leaves the body alone', async () => {
        const res = await run('skill_update', { slug: 'stripe-payments', description: 'mine', body: 'my own procedure' })
        expect(res).toContain('belongs to the stripe app')
        expect(await body('stripe-payments')).toContain('the connector procedure')
    })

    it('refuses skill_edit', async () => {
        const res = await run('skill_edit', { slug: 'stripe-payments', oldString: 'connector', newString: 'mine' })
        expect(res).toContain('read-only')
        expect(await body('stripe-payments')).toContain('the connector procedure')
    })

    it('refuses skill_delete', async () => {
        expect(await run('skill_delete', { slug: 'stripe-payments' })).toContain('read-only')
        expect(await body('stripe-payments')).toContain('the connector procedure')
    })

    it('refuses skill_write_file and skill_delete_file', async () => {
        expect(await run('skill_write_file', { slug: 'stripe-payments', path: 'references/api.md', content: 'mine' })).toContain('read-only')
        expect(await run('skill_delete_file', { slug: 'stripe-payments', path: 'references/api.md' })).toContain('read-only')
        expect(await readFile(resolve(skillDir(id, 'stripe-payments'), 'references/api.md'), 'utf8')).toBe('endpoints')
    })

    it('refuses a skill_create whose name lands on the same slug', async () => {
        expect(await run('skill_create', { name: 'stripe payments', description: 'd', body: 'mine' })).toContain('read-only')
        expect(await body('stripe-payments')).toContain('the connector procedure')
    })

    it('refuses a skill_import that would overwrite it', async () => {
        await writeFile(resolve(ws, 'takeover.md'), '---\nname: Stripe Payments\ndescription: mine\n---\n\nmy own procedure\n', 'utf8')
        expect(await run('skill_import', { sourcePath: 'takeover.md' })).toContain('read-only')
        expect(await body('stripe-payments')).toContain('the connector procedure')
    })

    it('marks it as read-only in skill_list and skill_read', async () => {
        expect(await run('skill_list', {})).toContain('[read-only, installed by the stripe app]')
        expect(await run('skill_read', { slug: 'stripe-payments' })).toContain('installed by the stripe app')
    })

    it('still lets the agent write its own skills', async () => {
        await run('skill_create', { name: 'Mine', description: 'd', body: 'my own' })
        expect(await run('skill_update', { slug: 'mine', description: 'd2', body: 'rewritten' })).toContain('Updated skill mine')
        expect(await run('skill_delete', { slug: 'mine' })).toContain('Deleted skill mine')
    })
})
