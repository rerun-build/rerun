// What `pnpm verify:ui` and the end-to-end suite share: the local Supabase stack, a hub that runs on it
// and nothing else, and a throwaway account signed in through the app's own magic link page.

// CommonJS, because Playwright loads the specs of this app as CommonJS and `pnpm verify:ui` is an ES module:
// both can require it.

const { execFileSync } = require('node:child_process')
const { existsSync, readFileSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { parseEnv } = require('node:util')

const { createClient } = require('@supabase/supabase-js')

const REPO_ROOT = resolve(__dirname, '../../../..')
const UI_DIR = join(REPO_ROOT, 'apps/ui')
// The edition the hub runs: Rerun Cloud when its private `cloud/` folder sits in the checkout, a
// self-hosted install otherwise (the open source repository and its CI).
const RERUN_CLOUD = existsSync(join(REPO_ROOT, 'cloud/packages/cloud/src'))

// Chromium's Local Network Access checks hold every request the page makes to the loopback stack
// (127.0.0.1:54421) and the dev server's HMR socket behind a permission prompt nobody answers.
const CHROMIUM_ARGS = ['--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests']

function readLocalStack() {
    let status
    try {
        status = execFileSync('pnpm', ['exec', 'supabase', 'status', '-o', 'env'], { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    } catch {
        throw new Error('The local Supabase stack is not running. Start it with `pnpm db:start`.')
    }
    const read = (key) => status.match(new RegExp(`^${key}="?([^"\n]*)"?$`, 'm'))?.[1]
    return { url: read('API_URL'), secretKey: read('SECRET_KEY') ?? read('SERVICE_ROLE_KEY'), publishableKey: read('PUBLISHABLE_KEY') ?? read('ANON_KEY'), mailpitUrl: read('MAILPIT_URL') ?? read('INBUCKET_URL') }
}

function adminClient(stack) {
    return createClient(stack.url, stack.secretKey, { auth: { persistSession: false, autoRefreshToken: false } })
}

// Variables the process environment would hand Next ahead of `.env`: a session that exports
// production's Supabase or Bird keys would otherwise put the local hub back on production.
function cleanServerEnv() {
    const env = { ...process.env }
    for (const key of Object.keys(env)) if (/SUPABASE|STRIPE|EXPO_PUBLIC/.test(key)) delete env[key]
    env.BIRD_API_KEY = ''
    return env
}

// The Supabase URL a hub started by `cleanServerEnv` resolves, in Next's own order of precedence.
function hubSupabaseUrl() {
    for (const file of ['.env.development.local', '.env.local', '.env.development', '.env']) {
        const path = join(UI_DIR, file)
        if (!existsSync(path)) continue
        const url = parseEnv(readFileSync(path, 'utf8')).NEXT_PUBLIC_SUPABASE_URL
        if (url) return url.trim()
    }
    return null
}

// A hub on production provisions a real user and a real workspace on every page load, and the
// production profile carries the live Stripe keys.
function assertHubOnLocalStack(stack) {
    const configured = hubSupabaseUrl()
    if (configured !== stack.url) {
        throw new Error(`The hub would run on ${configured ?? 'no Supabase'}, the local stack is ${stack.url}. Run \`pnpm cloud env:local\` (or point NEXT_PUBLIC_SUPABASE_URL of apps/ui/.env.local at the local stack), never test against production.`)
    }
}

function listeningPid(port) {
    try {
        return execFileSync('lsof', ['-nP', '-t', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' }).trim().split('\n')[0] || null
    } catch {
        return null
    }
}

function processCwd(pid) {
    const out = execFileSync('lsof', ['-a', '-p', pid, '-d', 'cwd', '-Fn'], { encoding: 'utf8' })
    return out.split('\n').find((line) => line.startsWith('n'))?.slice(1) ?? ''
}

// A hub already listening is reused only when it is this checkout's and was not started with a remote
// Supabase in its environment.
function assertRunningHubIsLocal(port) {
    const pid = listeningPid(port)
    if (!pid) return false
    const cwd = processCwd(pid)
    if (!cwd.startsWith(REPO_ROOT)) throw new Error(`Port ${port} is served from ${cwd}, another worktree. Stop it or set CONDUCTOR_PORT.`)
    const environ = execFileSync('ps', ['eww', '-o', 'command=', '-p', pid], { encoding: 'utf8' })
    if (/NEXT_PUBLIC_SUPABASE_URL=https:/.test(environ)) throw new Error(`The server on port ${port} was started with a remote NEXT_PUBLIC_SUPABASE_URL in its environment. Restart it.`)
    return true
}

async function mintSignInLink(admin, email) {
    const created = await admin.auth.admin.createUser({ email, email_confirm: true })
    if (created.error && !/already/i.test(created.error.message)) throw new Error(`Could not create ${email}: ${created.error.message}`)
    const link = await admin.auth.admin.generateLink({ type: 'magiclink', email })
    if (link.error) throw new Error(`Could not mint a sign-in link for ${email}: ${link.error.message}`)
    return { userId: link.data.user.id, tokenHash: link.data.properties.hashed_token }
}

// The web asks every new account for a phone number before the app opens. The throwaway account
// takes the wall's own "Skip for now".
async function skipPhoneStep(admin, userId) {
    const { error } = await admin.from('user_phones').update({ skipped_at: new Date().toISOString() }).eq('user_id', userId).is('skipped_at', null)
    if (error) throw new Error(`Could not skip the phone step: ${error.message}`)
}

async function signIn(context, base, admin, link) {
    const page = await context.newPage()
    await page.goto(`${base}/auth/confirm?token_hash=${link.tokenHash}&type=magiclink`, { timeout: 120_000 })
    // The confirm page is in the browser's language: its one submit button, whatever it says.
    await page.locator('form button[type="submit"]').first().click()
    await page.waitForURL((url) => !url.pathname.startsWith('/auth'), { timeout: 120_000 })
    await skipPhoneStep(admin, link.userId)
    await page.close()
}

async function workspaceOf(admin, userId) {
    const { data, error } = await admin.from('users').select('workspace_id').eq('id', userId).single()
    if (error) throw new Error(`Could not read the workspace of ${userId}: ${error.message}`)
    return data.workspace_id
}

// Without a machine, a workspace of Rerun Cloud sits behind the waitlist wall: a pool row of the local
// stack points it at an engine on `engineHost`, running or not.
async function linkEngine(admin, workspaceId, { engineHost, apiKey }) {
    const { data: existing } = await admin.from('engine_pool').select('id').eq('claimed_by_workspace_id', workspaceId).maybeSingle()
    const row = { engine_host: engineHost, engine_api_key: apiKey, status: 'claimed', claimed_by_workspace_id: workspaceId, provider: 'incus' }
    const write = existing ? admin.from('engine_pool').update(row).eq('id', existing.id) : admin.from('engine_pool').insert(row)
    const { error } = await write
    if (error) throw new Error(`Could not link an engine to workspace ${workspaceId}: ${error.message}`)
}

async function markOnboarded(admin, workspaceId) {
    const { error } = await admin.from('workspaces').update({ onboarded_at: new Date().toISOString() }).eq('id', workspaceId).is('onboarded_at', null)
    if (error) throw new Error(`Could not mark workspace ${workspaceId} onboarded: ${error.message}`)
}

// Every workspace the account is the only member of goes with it: its Boxes, its pool row, then the
// workspace itself (members, invitations and the rest cascade).
async function deleteSoloWorkspaces(admin, userId) {
    const { data: memberships } = await admin.from('workspace_members').select('workspace_id').eq('user_id', userId)
    for (const { workspace_id: workspaceId } of memberships ?? []) {
        const { count } = await admin.from('workspace_members').select('user_id', { count: 'exact', head: true }).eq('workspace_id', workspaceId)
        if (count !== 1) continue
        await admin.from('engine_pool').delete().eq('claimed_by_workspace_id', workspaceId)
        await admin.from('spaces').delete().eq('workspace_id', workspaceId)
        const { error } = await admin.from('workspaces').delete().eq('id', workspaceId)
        if (error) throw new Error(`Could not delete workspace ${workspaceId}: ${error.message}`)
    }
}

async function findAccount(admin, email) {
    const { data: listed, error } = await admin.auth.admin.listUsers({ perPage: 1000 })
    if (error) throw new Error(`Could not list the local accounts: ${error.message}`)
    return listed.users.find((user) => user.email === email) ?? null
}

async function deleteUser(admin, userId, { withWorkspaces = false } = {}) {
    if (withWorkspaces) await deleteSoloWorkspaces(admin, userId)
    const { data: row } = await admin.from('users').select('workspace_id').eq('id', userId).maybeSingle()
    if (row) await admin.from('engine_pool').delete().eq('claimed_by_workspace_id', row.workspace_id)
    const { error } = await admin.auth.admin.deleteUser(userId)
    if (error && !/not found/i.test(error.message)) throw new Error(`Could not delete user ${userId}: ${error.message}`)
}

async function deleteAccount(admin, email, options) {
    const account = await findAccount(admin, email)
    if (!account) return false
    await deleteUser(admin, account.id, options)
    return true
}

// The latest sign-in code the local stack mailed to `email`, caught by Mailpit.
async function lastMailedCode(mailpitUrl, email, { after }) {
    const deadline = Date.now() + 30_000
    while (Date.now() < deadline) {
        const response = await fetch(`${mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}&limit=1`)
        const { messages = [] } = await response.json()
        const latest = messages[0]
        if (latest && new Date(latest.Created) >= after) {
            const message = await (await fetch(`${mailpitUrl}/api/v1/message/${latest.ID}`)).json()
            const code = message.Text.match(/\b(\d{6})\b/)?.[1]
            if (code) return code
        }
        await new Promise((done) => setTimeout(done, 500))
    }
    throw new Error(`No sign-in code reached ${email} in Mailpit (${mailpitUrl}) within 30s.`)
}

module.exports = {
    REPO_ROOT,
    UI_DIR,
    RERUN_CLOUD,
    CHROMIUM_ARGS,
    readLocalStack,
    adminClient,
    cleanServerEnv,
    assertHubOnLocalStack,
    listeningPid,
    assertRunningHubIsLocal,
    mintSignInLink,
    signIn,
    workspaceOf,
    linkEngine,
    markOnboarded,
    deleteUser,
    deleteAccount,
    findAccount,
    lastMailedCode,
}
