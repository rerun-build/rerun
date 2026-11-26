import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const MIGRATIONS = join(__dirname, '../../../../../supabase/migrations')

const tableName = (raw: string) => raw.replace(/"/g, '').replace(/^public\./, '')

// Replays the migrations in order: a table that ends up with row level security, and still exists,
// must carry the policy that holds an account with two-step until its second step.
function replayMigrations(): { secured: string[]; missing: string[] } {
    const secured = new Set<string>()
    const guarded = new Set<string>()
    for (const file of readdirSync(MIGRATIONS).filter(name => name.endsWith('.sql')).sort()) {
        const sql = readFileSync(join(MIGRATIONS, file), 'utf8').replace(/--.*$/gm, '')
        const events: { at: number; apply: () => void }[] = []
        for (const match of sql.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?((?:"?public"?\.)?"?\w+"?)\s+enable\s+row\s+level\s+security/gi)) events.push({ at: match.index, apply: () => secured.add(tableName(match[1])) })
        for (const match of sql.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?((?:"?public"?\.)?"?\w+"?)\s+disable\s+row\s+level\s+security/gi)) events.push({ at: match.index, apply: () => secured.delete(tableName(match[1])) })
        for (const match of sql.matchAll(/drop\s+table\s+(?:if\s+exists\s+)?([^;]+);/gi)) {
            events.push({ at: match.index, apply: () => match[1].split(',').forEach(name => { secured.delete(tableName(name.trim().split(/\s/)[0])); guarded.delete(tableName(name.trim().split(/\s/)[0])) }) })
        }
        for (const match of sql.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?((?:"?public"?\.)?"?\w+"?)\s+rename\s+to\s+"?(\w+)"?/gi)) {
            events.push({
                at: match.index,
                apply: () => {
                    const from = tableName(match[1])
                    for (const set of [secured, guarded]) if (set.delete(from)) set.add(match[2])
                },
            })
        }
        for (const match of sql.matchAll(/create\s+policy\s+two_step_required\s+on\s+((?:"?public"?\.)?"?\w+"?)/gi)) events.push({ at: match.index, apply: () => guarded.add(tableName(match[1])) })
        for (const match of sql.matchAll(/drop\s+policy\s+(?:if\s+exists\s+)?two_step_required\s+on\s+((?:"?public"?\.)?"?\w+"?)/gi)) events.push({ at: match.index, apply: () => guarded.delete(tableName(match[1])) })
        events.sort((a, b) => a.at - b.at).forEach(event => event.apply())
    }
    return { secured: [...secured], missing: [...secured].filter(table => !guarded.has(table)).sort() }
}

type DefinedFunction = { body: string; definer: boolean; trigger: boolean; callable: boolean }

const functionName = (raw: string) => raw.replace(/"/g, '').replace(/^public\./, '')
const namesAuthenticated = (roles: string) => roles.split(',').some(role => role.trim().replace(/"/g, '').toLowerCase() === 'authenticated')
const FUNCTION_REF = /(?:"?public"?\.)?"?(\w+)"?/.source
const NEXT_STATEMENT = /\bcreate\s+(?:or\s+replace\s+)?(?:function|policy|table|view|trigger|index|type)\b/gi

// Replays the functions the same way: a security definer function reads its tables as their owner,
// past every policy, so one that authenticated may call must hold a session that owes its second step
// itself, or read through a function that does. Supabase lets authenticated call a new function of
// `public` until a migration revokes it.
function replayFunctions(): { callable: string[]; unguarded: string[] } {
    const functions = new Map<string, DefinedFunction>()
    for (const file of readdirSync(MIGRATIONS).filter(name => name.endsWith('.sql')).sort()) {
        const sql = readFileSync(join(MIGRATIONS, file), 'utf8').replace(/--.*$/gm, '')
        const events: { at: number; apply: () => void }[] = []
        for (const match of sql.matchAll(new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+${FUNCTION_REF}\\s*\\(`, 'gi'))) {
            NEXT_STATEMENT.lastIndex = match.index + match[0].length
            const end = NEXT_STATEMENT.exec(sql)?.index ?? sql.length
            const body = sql.slice(match.index, end)
            events.push({
                at: match.index,
                apply: () => {
                    const previous = functions.get(match[1])
                    functions.set(match[1], { body, definer: /security\s+definer/i.test(body), trigger: /returns\s+(?:event_)?trigger\b/i.test(body), callable: previous?.callable ?? true })
                },
            })
        }
        for (const match of sql.matchAll(new RegExp(`drop\\s+function\\s+(?:if\\s+exists\\s+)?${FUNCTION_REF}`, 'gi'))) events.push({ at: match.index, apply: () => functions.delete(functionName(match[1])) })
        for (const match of sql.matchAll(new RegExp(`revoke\\s+(?:all|execute)(?:\\s+privileges)?\\s+on\\s+function\\s+${FUNCTION_REF}\\s*\\([^)]*\\)\\s+from\\s+([^;]+);`, 'gi'))) {
            events.push({
                at: match.index,
                apply: () => {
                    const defined = functions.get(match[1])
                    if (defined && namesAuthenticated(match[2])) defined.callable = false
                },
            })
        }
        for (const match of sql.matchAll(new RegExp(`grant\\s+(?:all|execute)(?:\\s+privileges)?\\s+on\\s+function\\s+${FUNCTION_REF}\\s*\\([^)]*\\)\\s+to\\s+([^;]+);`, 'gi'))) {
            events.push({
                at: match.index,
                apply: () => {
                    const defined = functions.get(match[1])
                    if (defined && namesAuthenticated(match[2])) defined.callable = true
                },
            })
        }
        events.sort((a, b) => a.at - b.at).forEach(event => event.apply())
    }

    const guarded = new Set([...functions].filter(([, defined]) => defined.body.includes('two_step')).map(([name]) => name))
    for (let grew = true; grew; ) {
        grew = false
        for (const [name, defined] of functions) {
            if (guarded.has(name) || ![...guarded].some(other => new RegExp(`\\b${other}\\s*\\(`).test(defined.body.slice(defined.body.indexOf('(') + 1)))) continue
            guarded.add(name)
            grew = true
        }
    }
    const callable = [...functions].filter(([, defined]) => defined.definer && !defined.trigger && defined.callable).map(([name]) => name)
    return { callable, unguarded: callable.filter(name => !guarded.has(name)).sort() }
}

describe('two-step row level security', () => {
    it('guards every table with row level security', () => {
        const { secured, missing } = replayMigrations()
        expect(secured).toEqual(expect.arrayContaining(['users', 'workspaces', 'workspace_members', 'agents']))
        expect(missing).toEqual([])
    })

    it('guards every security definer function that a session may call', () => {
        const { callable, unguarded } = replayFunctions()
        expect(callable).toEqual(expect.arrayContaining(['current_workspace_ids', 'visible_agent_ids', 'unseen_runs']))
        expect(unguarded).toEqual([])
    })
})
