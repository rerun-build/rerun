import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { brainDbPath, installPath, schedulesDir, skillsDir, soulPath, triggersDir, agentDir } from '../config/paths.js'
import { rewriteMemoryText } from '../db/repos/memories.js'
import { getSharedDb, renameTableOwner, sharedDbExists } from '../db/sharedDb.js'
import { systemDbExists } from '../db/systemDb.js'
import { reattributePages } from '../brain/pages.js'
import { renameProposalAuthor } from '../brain/proposals.js'
import { rewriteScheduleText } from '../schedules/loader.js'
import { rewriteTriggerText } from '../triggers/loader.js'
import { writeFileAtomic } from '../lib/atomic-write.js'
import { logger } from '../lib/logger.js'
import { withAgentLock } from './lock.js'
import { unloadAgent } from './registry.js'
import { listAgentIdsOnDisk } from './loader.js'

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const WORD = String.raw`\p{L}\p{N}_`

// Case-insensitive like call_agent's own resolution. The look-behind keeps an address such as
// `team@scout.io` intact, the look-ahead keeps `@scout_2` pointing at the other agent.
export function replaceMention(text: string, fromHandle: string, toHandle: string): string {
    if (!fromHandle) return text
    return text.replace(new RegExp(`(?<![${WORD}.@])@${escapeRegExp(fromHandle)}(?![${WORD}])`, 'giu'), () => `@${toHandle}`)
}

// Case-sensitive on purpose: a display name such as "Scout" is also an ordinary word, and only the
// capitalised form written into the soul at creation is the agent's name. A mention is left to
// replaceMention.
export function replaceDisplayName(text: string, fromName: string, toName: string): string {
    const from = fromName.trim()
    if (!from) return text
    return text.replace(new RegExp(`(?<![${WORD}@])${escapeRegExp(from)}(?![${WORD}])`, 'gu'), () => toName.trim())
}

async function rewriteFile(path: string, rewrite: (text: string) => string): Promise<boolean> {
    if (!existsSync(path)) return false
    const text = await readFile(path, 'utf8')
    const next = rewrite(text)
    if (next === text) return false
    await writeFileAtomic(path, next)
    return true
}

async function markdownSlugs(dir: string): Promise<string[]> {
    if (!existsSync(dir)) return []
    const entries = await readdir(dir, { withFileTypes: true })
    return entries.filter(e => e.isFile() && e.name.endsWith('.md')).map(e => e.name.slice(0, -3))
}

async function skillFiles(id: string): Promise<string[]> {
    if (!existsSync(skillsDir(id))) return []
    const entries = await readdir(skillsDir(id), { withFileTypes: true })
    return entries.filter(e => e.isDirectory()).map(e => resolve(skillsDir(id), e.name, 'SKILL.md'))
}

// Only the live memories: `memory/archive` is what the agent let go of, and stays as it was.
async function memoryFiles(id: string): Promise<string[]> {
    const dir = resolve(agentDir(id), 'memory')
    return (await markdownSlugs(dir)).map(slug => resolve(dir, `${slug}.md`))
}

// One file that cannot be rewritten must not leave every file after it unrewritten, nor fail a
// rename that has already landed in config.json.
async function attempt(what: Record<string, string>, fn: () => Promise<unknown>): Promise<void> {
    try {
        await fn()
    } catch (err) {
        logger.warn({ ...what, err: String(err) }, 'rename: rewriting a reference failed')
    }
}

async function rewriteAgentMentions(id: string, fromHandle: string, rewrite: (text: string) => string): Promise<void> {
    await attempt({ agentId: id, part: 'files' }, async () => {
        const promptChanged = await withAgentLock(id, async () => {
            let changed = false
            for (const path of [soulPath(id), installPath(id)]) changed = (await rewriteFile(path, rewrite)) || changed
            for (const path of [...(await skillFiles(id)), ...(await memoryFiles(id))]) await attempt({ agentId: id, path }, () => rewriteFile(path, rewrite))
            return changed
        })
        if (promptChanged) unloadAgent(id)
    })
    for (const slug of await markdownSlugs(schedulesDir(id))) await attempt({ agentId: id, schedule: slug }, () => rewriteScheduleText(id, slug, rewrite))
    for (const slug of await markdownSlugs(triggersDir(id))) await attempt({ agentId: id, trigger: slug }, () => rewriteTriggerText(id, slug, rewrite))
    if (systemDbExists(id)) await attempt({ agentId: id, part: 'memories' }, () => rewriteMemoryText(id, `@${fromHandle}`, rewrite))
}

// The handle is how every other agent names this one in text, so moving it means moving each
// `@old` written anywhere a prompt is read from. Without it, a rename silently breaks every call
// to the agent: nothing fails at write time, only at run time. Past chats are left as they were.
export async function rewriteRenamedAgentReferences(agentId: string, fromHandle: string, toHandle: string): Promise<void> {
    const rewrite = (text: string) => replaceMention(text, fromHandle, toHandle)
    for (const id of await listAgentIdsOnDisk()) await rewriteAgentMentions(id, fromHandle, rewrite)
    await attempt({ part: 'brain pages' }, () => reattributePages(`agent:${fromHandle}`, `agent:${toHandle}`))
    if (existsSync(brainDbPath())) await attempt({ part: 'brain proposals' }, () => renameProposalAuthor(agentId, toHandle))
    if (sharedDbExists()) await attempt({ part: 'shared db' }, async () => renameTableOwner(await getSharedDb(), fromHandle, toHandle))
}
