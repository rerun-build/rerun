// The workspace every docs capture shows: Acme Studio, three Boxes, three coworkers with a history,
// a Brain, a Vault, routines and a Chief of Staff conversation. Everything is written straight into
// the local stack and the local engine, so no model is ever called. The ids are fixed: a coworker's
// buddy is drawn from its id, so the pictures stay the same from one run to the next.

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { ENGINE_PORT, fail, log } from '../verify/shared.mjs'

export const DEMO_NOW = new Date('2026-11-12T09:30:00.000Z')

const minutesAgo = (minutes) => new Date(DEMO_NOW.getTime() - minutes * 60_000).toISOString()

const ACME_LOGO = `data:image/svg+xml,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="#ff6b35"/><path d="M20 46 32 16l12 30h-7l-5-13-5 13z" fill="#fff"/></svg>',
)}`

const BOXES = [
    { id: '7d1f3a52-5c3e-4c4f-9d0e-0a1b2c3d4e01', name: 'Sales', col: 0 },
    { id: '7d1f3a52-5c3e-4c4f-9d0e-0a1b2c3d4e02', name: 'Finance', col: 9 },
    { id: '7d1f3a52-5c3e-4c4f-9d0e-0a1b2c3d4e03', name: 'Support', col: 18 },
]

export const COWORKERS = {
    leadScout: {
        id: '3a6b9c2d-1e4f-4a5b-8c7d-6e5f4a3b2c11',
        handle: 'lead-scout',
        name: 'Lead Scout',
        description: 'Finds agencies that match our ideal customer and books intro calls.',
        box: 'Sales',
        cell: [2, 2],
    },
    invoiceChaser: {
        id: '3a6b9c2d-1e4f-4a5b-8c7d-6e5f4a3b2c12',
        handle: 'invoice-chaser',
        name: 'Invoice Chaser',
        description: 'Follows up on unpaid invoices and keeps the payments table current.',
        box: 'Finance',
        cell: [11, 2],
    },
    inboxTriage: {
        id: '3a6b9c2d-1e4f-4a5b-8c7d-6e5f4a3b2c13',
        handle: 'inbox-triage',
        name: 'Inbox Triage',
        description: 'Sorts the support inbox, answers the easy ones, flags the rest.',
        box: 'Support',
        cell: [20, 2],
    },
}

const BRAIN_PAGES = [
    {
        slug: 'company',
        title: 'Acme Studio',
        type: 'company',
        content:
            '# Acme Studio\n\nA 12-person design studio in Lisbon. We build brand identities and websites for software companies between seed and series B.\n\n## What we sell\n\n- Brand identity sprints, 4 weeks\n- Marketing websites on Framer and Webflow\n- A monthly design retainer\n\n## Who we sell to\n\nFounders and heads of marketing of B2B software companies, 10 to 200 people, in Europe and North America.',
    },
    {
        slug: 'voice',
        title: 'Our voice',
        type: 'voice',
        content: '# Our voice\n\nWarm, direct, never salesy. Short sentences. We write like a designer talking to a founder over coffee: we say what we would do and why, and we skip the jargon.',
    },
    {
        slug: 'stack',
        title: 'Our tools',
        type: 'stack',
        content: '# Our tools\n\n- Gmail and Google Calendar\n- HubSpot for the pipeline\n- Stripe for invoices\n- Notion for projects\n- Slack for the team',
    },
]

function engineClient(apiKey) {
    const base = `http://127.0.0.1:${ENGINE_PORT}`
    return async function engine(method, path, body) {
        const response = await fetch(`${base}${path}`, {
            method,
            headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body),
        })
        const text = await response.text()
        if (!response.ok) fail(`Engine ${method} ${path} answered ${response.status}: ${text.slice(0, 300)}`)
        return text ? JSON.parse(text) : null
    }
}

async function check(promise, what) {
    const { data, error } = await promise
    if (error) fail(`Could not ${what}: ${error.message}`)
    return data
}

function openSystemDb(dataDir, engineAgentId) {
    const dir = join(dataDir, 'agents', engineAgentId, 'data')
    mkdirSync(dir, { recursive: true })
    return new DatabaseSync(join(dir, 'system.db'))
}

// Writes a conversation the way the engine would have kept it, ModelMessage content in `content_json`.
function writeConversation(dataDir, engineAgentId, session, turns) {
    const db = openSystemDb(dataDir, engineAgentId)
    try {
        db.prepare('INSERT OR REPLACE INTO sessions (id, agent_id, title, status, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
            session.id,
            engineAgentId,
            session.title,
            'open',
            'dashboard',
            turns[0].at,
            turns.at(-1).at,
        )
        const insert = db.prepare('INSERT OR REPLACE INTO messages (id, session_id, role, content_json, created_at) VALUES (?, ?, ?, ?, ?)')
        turns.forEach((turn, index) => insert.run(`${session.id}-m${String(index).padStart(2, '0')}`, session.id, turn.role, JSON.stringify(turn.content), turn.at))
    } finally {
        db.close()
    }
}

const text = (value) => [{ type: 'text', text: value }]

const CONVERSATIONS = {
    leadScout: {
        id: 'demo-session-lead-scout',
        title: 'This week’s prospects',
        status: 'idle',
        turns: [
            { role: 'user', at: minutesAgo(42), content: text('Find five agencies like Northwind that just raised and would need a new site.') },
            {
                role: 'assistant',
                at: minutesAgo(41),
                content: [
                    { type: 'text', text: 'Looking at recent rounds first.' },
                    { type: 'tool-call', toolCallId: 'call_search_1', toolName: 'web_search', input: { query: 'B2B software seed round Europe November 2026' } },
                ],
            },
            {
                role: 'tool',
                at: minutesAgo(40),
                content: [{ type: 'tool-result', toolCallId: 'call_search_1', toolName: 'web_search', output: { type: 'json', value: { results: 8 } } }],
            },
            {
                role: 'assistant',
                at: minutesAgo(38),
                content: text(
                    'Five good fits this week, all added to HubSpot as **New lead**:\n\n1. **Lattice Labs**, seed, Berlin: their site still says "coming soon"\n2. **Fernway**, series A, Lisbon: rebranding after a pivot\n3. **Quillmate**, seed, London: Webflow template, no case studies\n4. **Orbitly**, pre-seed, Paris: hiring a head of marketing\n5. **Tessellate**, series A, Amsterdam: launching in the US next quarter\n\nWant me to draft the intro emails?',
                ),
            },
        ],
    },
    invoiceChaser: {
        id: 'demo-session-invoice-chaser',
        title: 'Overdue invoices',
        status: 'awaiting_approval',
        turns: [
            { role: 'user', at: minutesAgo(12), content: text('Chase every invoice more than 30 days overdue.') },
            {
                role: 'assistant',
                at: minutesAgo(11),
                content: [
                    { type: 'text', text: 'Checking Stripe for open invoices.' },
                    { type: 'tool-call', toolCallId: 'call_invoices_1', toolName: 'stripe_list_invoices', input: { status: 'open' } },
                ],
            },
            {
                role: 'tool',
                at: minutesAgo(11),
                content: [{ type: 'tool-result', toolCallId: 'call_invoices_1', toolName: 'stripe_list_invoices', output: { type: 'json', value: { count: 3 } } }],
            },
            {
                role: 'assistant',
                at: minutesAgo(10),
                content: [
                    { type: 'text', text: 'Three invoices are past 30 days, for €14,200 in total. I drafted a short reminder for each one, in our voice.' },
                    {
                        type: 'tool-call',
                        toolCallId: 'call_approval_1',
                        toolName: 'request_approval',
                        input: { approvals: [{ action: 'Send 3 payment reminders', detail: 'Fernway (€6,400), Quillmate (€4,800) and Orbitly (€3,000), from billing@acmestudio.example' }] },
                    },
                ],
            },
        ],
    },
    inboxTriage: {
        id: 'demo-session-inbox-triage',
        title: 'Support inbox',
        status: 'idle',
        turns: [
            { role: 'user', at: minutesAgo(95), content: text('What came in overnight?') },
            {
                role: 'assistant',
                at: minutesAgo(94),
                content: text('Seven emails overnight. I answered four (two invoice copies, a meeting reschedule, a file request) and flagged three for you in **#support**: a refund request from Fernway, a contract question, and a bug on the Quillmate site.'),
            },
        ],
    },
}

const FOREMAN_SESSION = {
    id: 'demo-session-chief-of-staff',
    title: 'Getting started',
    turns: [
        {
            role: 'assistant',
            at: minutesAgo(180),
            content: text(
                'Hi, I read acmestudio.example. You are a design studio selling brand sprints and websites to B2B software founders.\n\nThree coworkers would take the most off your plate first:\n\n- **Lead Scout** finds funded companies that need a new site\n- **Invoice Chaser** follows up on unpaid invoices\n- **Inbox Triage** sorts the support inbox\n\nWhich one should I set up first?',
            ),
        },
        { role: 'user', at: minutesAgo(178), content: text('All three, start with Lead Scout.') },
        { role: 'assistant', at: minutesAgo(177), content: text('Done: all three are on the board, in the **Sales**, **Finance** and **Support** Boxes. Lead Scout is ready, open its chat to give it its first task.') },
    ],
}

// With `fixedIds`, the demo's own ids are cleared wherever they are: a demo account recreated under
// another email gets a new workspace, and the rows of the old one would hold them.
async function resetHubRows(admin, workspaceId, { fixedIds = false } = {}) {
    const agents = await check(admin.from('agents').select('id').eq('workspace_id', workspaceId), 'list the demo coworkers')
    const agentIds = [...new Set([...agents.map((agent) => agent.id), ...(fixedIds ? Object.values(COWORKERS).map((coworker) => coworker.id) : [])])]
    if (agentIds.length) {
        await check(admin.from('sessions').delete().in('agent_id', agentIds), 'clear the demo sessions')
        await check(admin.from('agents').delete().in('id', agentIds), 'clear the demo coworkers')
    }
    await check(admin.from('spaces').delete().eq('workspace_id', workspaceId), 'clear the demo Boxes')
    if (fixedIds) await check(admin.from('spaces').delete().in('id', BOXES.map((box) => box.id)), 'clear the demo Boxes')
    await check(admin.from('foreman_conversations').delete().eq('workspace_id', workspaceId), 'clear the Chief of Staff conversation')
}

const COMPUTER = { id: '5c2e8f14-7a3b-4d6e-9f01-2b3c4d5e6f70', handle: 'studio-mac', name: 'Studio Mac' }

// A computer linked from the desktop app, as the hub and the engine keep it. The engine learns its
// machine from the app once it connects: here that file is written the way it would have been, and
// the computer reads as last seen this morning.
async function seedComputer({ admin, workspaceId, userId, dataDir }) {
    await check(admin.from('remote_computers').delete().eq('id', COMPUTER.id), 'clear the demo computer')
    await check(
        admin.from('remote_computers').insert({
            id: COMPUTER.id,
            workspace_id: workspaceId,
            name: COMPUTER.name,
            handle: COMPUTER.handle,
            os: 'mac',
            arch: 'arm64',
            hostname: 'studio-mac.local',
            app_version: '0.9.0',
            token_hash: `docs-demo-${COMPUTER.id}`,
            linked_by: userId,
            last_seen_at: minutesAgo(25),
            created_at: minutesAgo(60 * 24 * 3),
        }),
        'link the demo computer',
    )
    const dir = join(dataDir, 'remote')
    mkdirSync(dir, { recursive: true })
    const computer = {
        ...COMPUTER,
        settings: { mode: 'remember', unattended: true, allowedPrograms: ['ffmpeg', 'magick'], allowedFolders: ['~/Projects/Acme'], screenAlways: false },
        lastSeenAt: minutesAgo(25),
        appVersion: '0.9.0',
        protocol: 1,
        capabilities: ['shell', 'files', 'jobs', 'screen'],
        facts: {
            hostname: 'studio-mac.local',
            os: 'mac',
            osVersion: '26.1',
            arch: 'arm64',
            cpu: 'Apple M4 Pro',
            cores: 14,
            memoryBytes: 48 * 1024 ** 3,
            shell: 'zsh',
            homeDir: '/Users/studio',
            workDir: '/Users/studio/Rerun',
            software: ['ffmpeg', 'magick', 'python3', 'node', 'git'],
        },
    }
    writeFileSync(join(dir, 'computers.json'), `${JSON.stringify({ computers: [computer] }, null, 4)}\n`, { mode: 0o600 })
}

// Templates the library lists, as the Rerun team would have published them. Their slugs are the
// demo's own, so a run clears and writes them again without touching any other template.
const TEMPLATES = [
    {
        slug: 'docs-demo-agency-growth',
        title: 'Agency growth team',
        tagline: 'Find funded companies, qualify them and book the intro calls.',
        long_description: 'Three coworkers that keep an agency pipeline full. **Lead Scout** finds companies that just raised, **Qualifier** checks each one against your ideal customer, and **Booker** writes the intro email and books the call once you approve it.',
        category: 'agencies',
        tags: ['sales', 'prospecting'],
        setup_minutes: 10,
        featured: true,
        agents: [
            { key: 'lead-scout', name: 'Lead Scout', role: 'Prospecting', description: 'Finds funded companies that need a new site.', connectorSlugs: ['hubspot'], setupRequired: true },
            { key: 'qualifier', name: 'Qualifier', role: 'Qualification', description: 'Checks each lead against your ideal customer.', connectorSlugs: ['hubspot'], setupRequired: false },
            { key: 'booker', name: 'Booker', role: 'Outreach', description: 'Writes the intro email and books the call.', connectorSlugs: ['gmail', 'google-calendar'], setupRequired: true },
        ],
        connectors: [
            { slug: 'hubspot', name: 'HubSpot', icon: '/services/hubspot.svg' },
            { slug: 'gmail', name: 'Gmail', icon: '/services/gmail.svg' },
            { slug: 'google-calendar', name: 'Google Calendar', icon: '/services/google-calendar.svg' },
        ],
    },
    {
        slug: 'docs-demo-finance-desk',
        title: 'Finance desk',
        tagline: 'Chase unpaid invoices and keep the books current.',
        long_description: '**Invoice Chaser** follows up on every invoice past its due date, in your voice, and **Bookkeeper** matches each Stripe payment to its invoice.',
        category: 'saas',
        tags: ['finance'],
        setup_minutes: 5,
        featured: false,
        agents: [
            { key: 'invoice-chaser', name: 'Invoice Chaser', role: 'Collections', description: 'Follows up on unpaid invoices.', connectorSlugs: ['stripe', 'gmail'], setupRequired: true },
            { key: 'bookkeeper', name: 'Bookkeeper', role: 'Accounting', description: 'Matches payments to invoices.', connectorSlugs: ['stripe'], setupRequired: false },
        ],
        connectors: [
            { slug: 'stripe', name: 'Stripe', icon: '/services/stripe.svg' },
            { slug: 'gmail', name: 'Gmail', icon: '/services/gmail.svg' },
        ],
    },
    {
        slug: 'docs-demo-support-inbox',
        title: 'Support inbox',
        tagline: 'Answer the easy emails, flag the rest in Slack.',
        long_description: '**Inbox Triage** reads the support inbox every morning, answers what it can from your Brain and posts the rest in a Slack channel.',
        category: 'productivity',
        tags: ['support'],
        setup_minutes: 5,
        featured: false,
        agents: [{ key: 'inbox-triage', name: 'Inbox Triage', role: 'Support', description: 'Sorts the support inbox.', connectorSlugs: ['gmail', 'slack'], setupRequired: true }],
        connectors: [
            { slug: 'gmail', name: 'Gmail', icon: '/services/gmail.svg' },
            { slug: 'slack', name: 'Slack', icon: '/services/slack.png' },
        ],
    },
]

async function seedTemplates(admin) {
    await check(admin.from('templates').delete().in('slug', TEMPLATES.map((template) => template.slug)), 'clear the demo templates')
    await check(
        admin.from('templates').insert(
            TEMPLATES.map((template, index) => ({
                ...template,
                gallery: [],
                status: 'published',
                show_in_library: true,
                pricing_model: 'free',
                price_amount_cents: 0,
                published_at: minutesAgo(60 * 24 * (10 + index)),
            })),
        ),
        'publish the demo templates',
    )
}

export async function seedDemoWorkspace({ admin, workspaceId, userId, email, apiKey, dataDir }) {
    const engine = engineClient(apiKey)

    await check(
        admin
            .from('workspaces')
            .update({
                name: 'Acme Studio',
                icon_url: ACME_LOGO,
                onboarded_at: minutesAgo(60 * 24 * 7),
                subscription_status: 'active',
                rerun_budget_micros: 0,
                rerun_topup_micros: 0,
                rerun_credit_paused_at: minutesAgo(60),
            })
            .eq('id', workspaceId),
        'name the demo workspace',
    )

    await resetHubRows(admin, workspaceId, { fixedIds: true })
    await check(
        admin.from('spaces').insert(BOXES.map((box, index) => ({ id: box.id, workspace_id: workspaceId, name: box.name, col_start: box.col, row_start: 0, col_end: box.col + 7, row_end: 7, sidebar_order: index }))),
        'create the demo Boxes',
    )

    const engineIds = {}
    for (const [key, coworker] of Object.entries(COWORKERS)) {
        const created = await engine('POST', '/agents', { config: { name: coworker.handle, displayName: coworker.name, description: coworker.description } })
        engineIds[key] = created.id
        const box = BOXES.find((candidate) => candidate.name === coworker.box)
        await check(
            admin.from('agents').insert({
                id: coworker.id,
                workspace_id: workspaceId,
                space_id: box.id,
                engine_agent_id: created.id,
                handle: coworker.handle,
                name: coworker.name,
                description: coworker.description,
                col: coworker.cell[0],
                row: coworker.cell[1],
                sidebar_order: 0,
            }),
            `create ${coworker.name}`,
        )

        const conversation = CONVERSATIONS[key]
        await engine('GET', `/agents/${created.id}/sessions`)
        writeConversation(dataDir, created.id, conversation, conversation.turns)
        const last = conversation.turns.findLast((turn) => turn.role !== 'tool')
        await check(
            admin.from('sessions').insert({
                agent_id: coworker.id,
                engine_session_id: conversation.id,
                kind: 'general',
                title: conversation.title,
                status: conversation.status,
                first_message: conversation.turns[0].content[0].text,
                last_message: last.content.find((part) => part.type === 'text')?.text ?? null,
                last_message_from: last.role === 'user' ? 'user' : 'agent',
                last_message_at: last.at,
                created_at: conversation.turns[0].at,
                updated_at: last.at,
            }),
            `open ${coworker.name}'s conversation`,
        )
    }

    await engine('GET', '/agents/foreman/sessions')
    writeConversation(dataDir, 'foreman', FOREMAN_SESSION, FOREMAN_SESSION.turns)
    // Its conversations hang off its agent row, which the reset above took away with the coworkers.
    const [foreman] = await check(admin.from('agents').insert({ workspace_id: workspaceId, kind: 'foreman', space_id: null, name: 'Chief of Staff', engine_agent_id: 'foreman' }).select('id'), 'write the Chief of Staff')
    const [general] = await check(
        admin.from('sessions').insert({
            agent_id: foreman.id,
            owner_user_id: userId,
            kind: 'general',
            engine_session_id: FOREMAN_SESSION.id,
            status: 'idle',
            source: 'dashboard',
            title: 'General',
            created_at: FOREMAN_SESSION.turns[0].at,
            updated_at: FOREMAN_SESSION.turns.at(-1).at,
        }).select('id'),
        'open the Chief of Staff conversation',
    )
    await check(
        admin.from('foreman_conversations').insert({
            id: general.id,
            workspace_id: workspaceId,
            user_id: userId,
            backend: 'engine',
            kind: 'general',
            engine_session_id: FOREMAN_SESSION.id,
            status: 'idle',
            created_at: FOREMAN_SESSION.turns[0].at,
            updated_at: FOREMAN_SESSION.turns.at(-1).at,
        }),
        'copy it for the shipped builds',
    )

    for (const page of BRAIN_PAGES) {
        await engine('PUT', `/brain/pages/${page.slug}`, { title: page.title, type: page.type, content: page.content, sources: [], baseHash: null, author: `user:${email}` })
    }

    await engine('POST', '/vault', { kind: 'service', slug: 'gmail', name: 'gmail', label: 'hello@acmestudio.example', status: 'active', agentIds: [engineIds.leadScout, engineIds.inboxTriage] })
    await engine('POST', '/vault', { kind: 'service', slug: 'hubspot', name: 'hubspot', label: 'Acme Studio', status: 'active', agentIds: [engineIds.leadScout] })
    await engine('POST', '/vault', { kind: 'service', slug: 'stripe', name: 'stripe', label: 'Acme Studio', status: 'active', agentIds: [engineIds.invoiceChaser] })
    await engine('POST', '/vault', { kind: 'secret', name: 'Companies House API key', env: { COMPANIES_HOUSE_API_KEY: 'demo-not-a-real-key' }, agentIds: [engineIds.leadScout] })

    // Weekday mornings, so nothing fires while the captures run.
    await engine('POST', `/agents/${engineIds.leadScout}/schedules`, {
        name: 'Monday prospects',
        description: 'Five new funded companies every Monday',
        body: 'Find five B2B software companies that raised in the last two weeks and would need a new site. Add them to HubSpot as New lead.',
        cron: '0 8 * * 1',
        timezone: 'Europe/Lisbon',
    })
    await engine('POST', `/agents/${engineIds.invoiceChaser}/schedules`, {
        name: 'Overdue invoices',
        description: 'Chase what is more than 30 days late',
        body: 'Check Stripe for invoices more than 30 days overdue and draft a reminder for each one.',
        cron: '0 9 * * 2',
        timezone: 'Europe/Lisbon',
    })
    await engine('POST', `/agents/${engineIds.invoiceChaser}/triggers`, {
        name: 'Stripe payment',
        description: 'Records each payment Stripe sends',
        body: 'A Stripe payment event arrives. Mark the invoice as paid in the payments table.',
        methods: ['POST'],
    })

    await engine('POST', `/agents/${engineIds.leadScout}/skills`, {
        name: 'qualify-a-lead',
        description: 'Decide whether a company is worth an intro call, before adding it to HubSpot.',
        body: '1. Open the company website and its last funding announcement.\n2. Keep it only if it sells B2B software, has 10 to 200 people and raised in the last six months.\n3. Look for a weak spot we can fix: no case studies, an old template, a rebrand in progress.\n4. Add it to HubSpot as **New lead**, with the weak spot in one line in the notes.\n5. Never email anyone without approval.',
    })

    await engine('POST', `/agents/${engineIds.invoiceChaser}/data/execute`, { sql: 'DROP TABLE IF EXISTS payments' })
    await engine('POST', `/agents/${engineIds.invoiceChaser}/data/execute`, {
        sql: 'CREATE TABLE payments (invoice TEXT PRIMARY KEY, client TEXT NOT NULL, amount_eur INTEGER NOT NULL, due_on TEXT NOT NULL, status TEXT NOT NULL, reminded_on TEXT)',
    })
    await engine('POST', `/agents/${engineIds.invoiceChaser}/data/execute`, {
        sql: `INSERT INTO payments (invoice, client, amount_eur, due_on, status, reminded_on) VALUES
            ('INV-2041', 'Fernway', 6400, '2026-10-01', 'overdue', '2026-11-12'),
            ('INV-2043', 'Quillmate', 4800, '2026-10-06', 'overdue', '2026-11-12'),
            ('INV-2046', 'Orbitly', 3000, '2026-10-10', 'overdue', '2026-11-12'),
            ('INV-2050', 'Lattice Labs', 9600, '2026-11-02', 'paid', NULL),
            ('INV-2052', 'Tessellate', 12800, '2026-11-20', 'open', NULL),
            ('INV-2053', 'Northwind', 5200, '2026-11-28', 'open', NULL)`,
    })

    await seedComputer({ admin, workspaceId, userId, dataDir })
    await seedTemplates(admin)

    log(`Seeded Acme Studio: ${Object.keys(COWORKERS).length} coworkers, ${BRAIN_PAGES.length} Brain pages, the Vault, routines, a skill, a payments table, a computer and templates.`)
    return { engineIds }
}

// A second account, still on its welcome page: the onboarding is only shown to a workspace with no
// coworker that never finished it. A scene moves it from one question to the next with `answers`.
export async function seedOnboardingWorkspace({ admin, workspaceId }) {
    await check(
        admin.from('workspaces').update({ name: null, icon_url: null, onboarded_at: null, subscription_status: null }).eq('id', workspaceId),
        'reset the onboarding workspace',
    )
    await resetHubRows(admin, workspaceId)
    const setAnswers = (answers) => check(admin.from('workspace_onboarding').upsert({ workspace_id: workspaceId, answers, updated_at: DEMO_NOW.toISOString() }, { onConflict: 'workspace_id' }), 'set the onboarding answers')
    await setAnswers({})
    return { setAnswers }
}
