import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

import ts from 'typescript'
import { describe, expect, it } from 'vitest'

// The team of an organization is invisible in the workspaces of its clients, and one list read past
// the helper is enough to show them. This reads the source: a list of `workspace_members` goes through
// workspace-members.ts, a name is never read without knowing whose it is, and whoever acts says
// whether they are there for the organization.

const UI = process.cwd()
const CLOUD = join(UI, '../../cloud/packages/cloud/src')
const SKIPPED = new Set(['node_modules', '.next', 'test', '__tests__', 'database.types.ts'])
// The static files of the app, at its root alone: `app/api/public` holds routes anyone may call.
const STATIC_FILES = 'public'

function sourcesIn(root: string, top = true): string[] {
    if (!existsSync(root)) return []
    return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
        if (SKIPPED.has(entry.name) || entry.name.startsWith('.') || (top && entry.name === STATIC_FILES)) return []
        const path = join(root, entry.name)
        if (entry.isDirectory()) return sourcesIn(path, false)
        return /\.tsx?$/.test(entry.name) && !/\.(test|spec|d)\.tsx?$/.test(entry.name) ? [path] : []
    })
}

const files = [...sourcesIn(UI).map(path => ({ name: relative(UI, path), path })), ...sourcesIn(CLOUD).map(path => ({ name: `cloud/${relative(CLOUD, path)}`, path }))]
const parsed = files.map(({ name, path }) => {
    const text = readFileSync(path, 'utf8')
    return { name, text, tree: () => ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS) }
})

function every(node: ts.Node, visit: (node: ts.Node) => void): void {
    visit(node)
    node.forEachChild(child => every(child, visit))
}

const called = (node: ts.CallExpression) => (ts.isIdentifier(node.expression) ? node.expression.text : ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : '')

const keysOf = (node: ts.ObjectLiteralExpression) => node.properties.flatMap(property => (property.name && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) ? [property.name.text] : []))

const WRITES = new Set(['insert', 'update', 'upsert', 'delete'])

function chainOf(from: ts.CallExpression): string[] {
    const methods: string[] = []
    let node: ts.Node = from
    while (ts.isPropertyAccessExpression(node.parent) && ts.isCallExpression(node.parent.parent)) {
        methods.push(node.parent.name.text)
        node = node.parent.parent
    }
    return methods
}

// What the literal 'workspace_members' is there for: null when it lists nobody.
function listRead(literal: ts.StringLiteralLike): string | null {
    const parent = literal.parent
    if (ts.isLiteralTypeNode(parent)) return null
    if (!ts.isCallExpression(parent)) return 'used outside a call'
    const name = called(parent)
    if (name === 'from') return chainOf(parent).some(method => WRITES.has(method)) ? null : 'a raw read'
    if (name === 'selectSingle' || name === 'selectMaybeSingle') {
        const filters = parent.arguments.find((arg): arg is ts.ObjectLiteralExpression => ts.isObjectLiteralExpression(arg))
        const keys = filters ? keysOf(filters) : []
        return keys.includes('user_id') && keys.includes('workspace_id') ? null : 'one row, whose person is not named'
    }
    return `${name}()`
}

// One person's own memberships, or their organization's own reading of its team.
const LISTS_ALLOWED: Record<string, { reads: number; why: string }> = {
    'app/api/_auth/workspace-members.ts': { reads: 4, why: 'the helper itself' },
    'app/api/_services/account-deletion.service.ts': { reads: 1, why: 'the workspaces of the account being deleted, the ones it only runs for an organization left out' },
    'app/api/_services/default-workspace.service.ts': { reads: 1, why: 'where one account is moved to, its own workspaces first' },
    'app/api/_services/sandbox.service.ts': { reads: 1, why: "the caller's own sandbox, which no organization holds" },
    'app/api/_services/workspace.service.ts': { reads: 1, why: "the caller's own switcher, with the client workspaces they opened" },
    'app/(authflow)/(onboarding)/welcome/page.tsx': { reads: 1, why: "the caller's own switcher" },
    'supabase/session/getServerSession.ts': { reads: 1, why: "the caller's own workspaces, to pick one the host opens" },
    'supabase/session/SessionProvider.tsx': { reads: 2, why: "the caller's own rows, all that RLS answers" },
    'ee/services/organization-brand.service.ts': { reads: 1, why: 'the workspaces one account works in, the ones it only runs left out, for the brand of its sign-in email' },
    'ee/services/organization-sign-in.service.ts': { reads: 1, why: "the people of one organization, to whom alone its sign-in mails a code; nothing is shown" },
    'ee/services/organization-join.service.ts': { reads: 1, why: "one account's own memberships" },
    'ee/services/organization-reach.service.ts': { reads: 1, why: "one account's own memberships, to tell whether it works beyond an organization; nothing is shown" },
    'ee/services/organization-staff.service.ts': { reads: 2, why: 'the staff rows of one person or one workspace, taken away with their team' },
}

// Whose name or address is read, and why it is never staff's in front of a client.
const NAMES_ALLOWED: Record<string, string> = {
    'app/api/_services/members.service.ts': 'resolves staff to the brand for anything shown',
    'app/api/_services/me.service.ts': 'the caller reading their own profile, and messageAuthorOf, which signs staff with the brand',
    'app/api/_actions/space-access.actions.ts': 'the members the helper lists',
    'app/api/_services/workspace-owner.service.ts': 'the owner and the author for analytics, staff left out',
    'app/api/_services/sign-in-code.service.ts': 'the account signing in',
    'app/api/_services/phone-delivery.service.ts': 'the account behind a phone number',
    'app/api/_services/phone-sign-in.service.ts': 'the account signing in',
    'app/api/_services/desktop-auth.service.ts': 'the account signing in',
    'lib/foreman/inbox-tools.ts': 'signed through messageAuthorOf',
    'lib/foreman/checkin-context.ts': 'the founder, staff left out',
    'app/api/_services/naming.service.ts': 'the founder, staff left out, whose first name the workspace may carry',
    'lib/apps/analytics.ts': 'the first member for analytics, staff left out',
    'trigger/explore-company.ts': 'the first member, staff left out',
    'lib/email/recipient.ts': 'the address of a recipient, whom every caller took from the helper or from the team of an organization',
    'ee/lib/lifecycle/recipient.ts': 'the address of a recipient the callers took from the helper',
    'ee/services/referral.service.ts': "the people someone referred, shown to them alone and to nobody's client",
    'ee/services/referral-attach.service.ts': 'the first name of who referred, on their own link',
    'ee/lib/organizations/console.server.ts': 'the caller reading their own name, in the console',
    'ee/services/organization-admin.service.ts': 'the console, read by the team alone',
    'ee/services/organization-credit.service.ts': 'the console, read by the team alone',
    'ee/services/organization-team.service.ts': 'the console, read by the team alone',
    'ee/services/organization-sign-in.service.ts': 'the address a code is asked for, compared and never shown',
    'cloud/lib/newsletter/audience.ts': 'every account, as a recipient',
}

const READS_A_NAME = new Set(['getUserById', 'listUsers', 'resolveMemberIdentities', 'displayNameOf'])

// Build an actor only to compute what someone reaches: it signs nothing.
const UNSIGNED_ACTORS = new Set(['app/api/_actions/space-access.actions.ts', 'app/api/_services/notification.service.ts'])

describe('the source', () => {
    it('is really read', () => {
        expect(parsed.length).toBeGreaterThan(1000)
        expect(parsed.some(file => file.name === 'app/api/_auth/workspace-members.ts')).toBe(true)
    })

    it('lists the people of a workspace through the helper alone', () => {
        const found: Record<string, string[]> = {}
        for (const { name, text, tree } of parsed) {
            if (!text.includes('workspace_members')) continue
            every(tree(), node => {
                if (!ts.isStringLiteralLike(node) && !ts.isTemplateHead(node)) return
                if (!node.text.includes('workspace_members')) return
                const read = ts.isStringLiteralLike(node) && node.text === 'workspace_members' ? listRead(node) : `inside "${node.text}"`
                if (read) (found[name] ??= []).push(read)
            })
        }
        const counts = Object.fromEntries(Object.entries(found).map(([name, reads]) => [name, reads.length]))
        const allowed = Object.fromEntries(Object.entries(LISTS_ALLOWED).flatMap(([name, { reads }]) => (parsed.some(file => file.name === name) ? [[name, reads]] : [])))
        expect(counts, JSON.stringify(found, null, 2)).toEqual(allowed)
    })

    it('reads a name or an address only where whose it is was settled', () => {
        const found = new Set<string>()
        for (const { name, text, tree } of parsed) {
            if (![...READS_A_NAME].some(read => text.includes(read))) continue
            every(tree(), node => {
                if (ts.isCallExpression(node) && READS_A_NAME.has(called(node))) found.add(name)
            })
        }
        const unexpected = [...found].filter(name => !(name in NAMES_ALLOWED))
        const stale = Object.keys(NAMES_ALLOWED).filter(name => !found.has(name) && parsed.some(file => file.name === name))
        expect({ unexpected, stale }).toEqual({ unexpected: [], stale: [] })
    })

    it('says of whoever acts whether they are there for the organization', () => {
        const silent: string[] = []
        for (const { name, text, tree } of parsed) {
            if (UNSIGNED_ACTORS.has(name) || !text.includes('boxScope')) continue
            every(tree(), node => {
                if (!ts.isObjectLiteralExpression(node)) return
                const keys = keysOf(node)
                const acts = keys.includes('userId') && keys.includes('boxScope') && (keys.includes('workspaceId') || keys.includes('workspace'))
                if (acts && !keys.includes('organizationStaff')) silent.push(name)
            })
        }
        expect(silent).toEqual([])
    })
})
