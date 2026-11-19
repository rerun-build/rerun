import { MAX_SKILL_FILE_BYTES, MAX_SKILL_FOLDER_BYTES, MAX_SKILL_REFERENCE_FILES } from '@moldwright/contracts'

export { MAX_SKILL_FILE_BYTES, MAX_SKILL_FOLDER_BYTES, MAX_SKILL_REFERENCE_FILES } from '@moldwright/contracts'

export const SKILL_ENTRY = 'SKILL.md'
const IGNORED_NAMES = new Set(['.DS_Store', 'Thumbs.db'])
export const SKILL_TEXT_EXTENSIONS = new Set(['md', 'markdown', 'txt', 'json', 'yaml', 'yml', 'csv', 'tsv', 'js', 'mjs', 'ts', 'py', 'rb', 'sh', 'sql', 'html', 'css', 'xml', 'toml', 'ini', 'env'])

export type SkillFolderImport = {
    name: string
    content: string
    files: { path: string; content: string }[]
    skipped: string[]
}

type Entry = { file: File; path: string }

export function extensionOf(path: string): string {
    return path.split('/').pop()?.split('.').pop()?.toLowerCase() ?? ''
}

export function isTextSkillFile(path: string): boolean {
    return SKILL_TEXT_EXTENSIONS.has(extensionOf(path))
}

function rootOf(path: string): string {
    return path.slice(0, -SKILL_ENTRY.length).replace(/\/$/, '')
}

function skillRoots(entries: Entry[]): string[] {
    const roots = entries
        .filter(entry => entry.path === SKILL_ENTRY || entry.path.endsWith(`/${SKILL_ENTRY}`))
        .map(entry => rootOf(entry.path))
        .sort((a, b) => a.length - b.length)
    return roots.filter((root, index) => !roots.slice(0, index).some(parent => root.startsWith(parent ? `${parent}/` : '')))
}

async function readSkillAt(root: string, entries: Entry[]): Promise<SkillFolderImport> {
    const prefix = root ? `${root}/` : ''
    const owned = entries.filter(entry => entry.path.startsWith(prefix)).map(entry => ({ ...entry, path: entry.path.slice(prefix.length) }))
    const skill = owned.find(entry => entry.path === SKILL_ENTRY)!
    const kept = owned.filter(entry => entry.path !== SKILL_ENTRY && isTextSkillFile(entry.path))
    const skipped = owned.filter(entry => !isTextSkillFile(entry.path)).map(entry => entry.path)
    const name = root.split('/').pop() || 'skill'

    if (kept.length > MAX_SKILL_REFERENCE_FILES) throw new Error(`${name} has too many reference files (max ${MAX_SKILL_REFERENCE_FILES})`)

    let total = 0
    for (const entry of [skill, ...kept]) {
        if (entry.file.size > MAX_SKILL_FILE_BYTES) throw new Error(`${name}/${entry.path} is too large (max 10 MB per file)`)
        total += entry.file.size
    }
    if (total > MAX_SKILL_FOLDER_BYTES) throw new Error(`${name} is too large (max 50 MB per skill)`)

    const files = await Promise.all(kept.map(async entry => ({ path: entry.path, content: await entry.file.text() })))
    return { name, content: await skill.file.text(), files, skipped }
}

export async function readSkillFolders(fileList: FileList | File[]): Promise<SkillFolderImport[]> {
    const entries = Array.from(fileList)
        .map(file => ({ file, path: file.webkitRelativePath || file.name }))
        .filter(entry => entry.path && !entry.path.split('/').some(part => IGNORED_NAMES.has(part)))

    const roots = skillRoots(entries)
    if (!roots.length) throw new Error('No SKILL.md found in this folder')

    return Promise.all(roots.map(root => readSkillAt(root, entries)))
}
