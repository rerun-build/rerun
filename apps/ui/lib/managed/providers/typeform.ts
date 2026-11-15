import type { ManagedProvider, ManagedTool } from '../types'
import { bool, num, obj, objList, requireStr, str, strList } from './args'

const TYPEFORM_BASE = 'https://api.typeform.com'
const MAX_FORMS_PAGE = 200
const MAX_RESPONSES_PAGE = 1000

async function typeformApi(accessToken: string, method: string, path: string, body?: unknown): Promise<unknown> {
    const res = await fetch(`${TYPEFORM_BASE}${path}`, {
        method,
        headers: {
            Authorization: `Bearer ${accessToken}`,
            ...(body ? { 'Content-Type': 'application/json' } : {}),
            Accept: 'application/json',
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
    })
    const text = await res.text()
    const data = text ? (JSON.parse(text) as Record<string, unknown>) : {}
    if (!res.ok) {
        const message = typeof data.description === 'string' ? data.description : typeof data.message === 'string' ? data.message : res.statusText
        throw new Error(`Typeform API ${res.status}: ${message}`)
    }
    return text ? data : { ok: true }
}

function query(params: Record<string, string | number | boolean | undefined>): string {
    const search = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) search.set(key, String(value))
    }
    const qs = search.toString()
    return qs ? `?${qs}` : ''
}

function clamp(value: number | undefined, max: number): number | undefined {
    return value === undefined ? undefined : Math.min(Math.max(1, Math.floor(value)), max)
}

function hrefOf(collection: string, id: string): { href: string } {
    return { href: `${TYPEFORM_BASE}/${collection}/${id}` }
}

const FIELD_TYPES = [
    'calendar',
    'checkbox',
    'contact_info',
    'date',
    'dropdown',
    'email',
    'file_upload',
    'google_calendar',
    'group',
    'legal',
    'long_text',
    'matrix',
    'multi_format',
    'multiple_choice',
    'nps',
    'number',
    'opinion_scale',
    'payment',
    'phone_number',
    'picture_choice',
    'ranking',
    'rating',
    'short_text',
    'signature',
    'statement',
    'website',
    'yes_no',
]

const FIELDS_SCHEMA = {
    type: 'array',
    description: `The form's questions, in order. Each item is { ref, title, type, properties, validations }: "ref" is a readable id you choose and reuse in logic, "title" is the question shown to the respondent, "type" is one of ${FIELD_TYPES.join(', ')}. "properties" holds type-specific config (e.g. description, choices: [{ label }] for multiple_choice/dropdown, steps + labels for opinion_scale) and "validations" holds constraints (e.g. { required: true, max_length: 200 }).`,
    items: { type: 'object' },
}

const tools: ManagedTool[] = [
    {
        name: 'typeform_get_account',
        description: 'Get the connected Typeform account (alias, email, language). Use it to confirm which account the coworker is acting on behalf of.',
        inputSchema: { type: 'object', properties: {} },
        execute: async (_args, token) => typeformApi(token, 'GET', '/me'),
    },
    {
        name: 'typeform_list_workspaces',
        description: "List the account's workspaces. A workspace id is needed to create a form somewhere other than the default workspace, or to list only that workspace's forms.",
        inputSchema: {
            type: 'object',
            properties: {
                search: { type: 'string', description: 'Filter workspaces whose name contains this string.' },
                page: { type: 'number', description: 'Page number, starting at 1.' },
                pageSize: { type: 'number', description: 'Workspaces per page (default 10, max 200).' },
            },
        },
        execute: async (args, token) =>
            typeformApi(token, 'GET', `/workspaces${query({ search: str(args, 'search'), page: num(args, 'page'), page_size: clamp(num(args, 'pageSize'), MAX_FORMS_PAGE) })}`),
    },
    {
        name: 'typeform_list_forms',
        description: "List the account's forms. Returns each form's id, title, whether it is public, and its display (public) URL. Always resolve a form id from here before reading or editing a form.",
        inputSchema: {
            type: 'object',
            properties: {
                search: { type: 'string', description: 'Filter forms whose title contains this string.' },
                workspaceId: { type: 'string', description: 'Restrict to the forms of one workspace.' },
                isPublic: { type: 'boolean', description: 'Restrict to published (true) or unpublished (false) forms.' },
                sortBy: { type: 'string', enum: ['created_at', 'last_updated_at'], description: 'Sort field.' },
                orderBy: { type: 'string', enum: ['asc', 'desc'], description: 'Sort direction.' },
                page: { type: 'number', description: 'Page number, starting at 1.' },
                pageSize: { type: 'number', description: `Forms per page (default 10, max ${MAX_FORMS_PAGE}).` },
            },
        },
        execute: async (args, token) =>
            typeformApi(
                token,
                'GET',
                `/forms${query({
                    search: str(args, 'search'),
                    workspace_id: str(args, 'workspaceId'),
                    is_public: bool(args, 'isPublic'),
                    sort_by: str(args, 'sortBy'),
                    order_by: str(args, 'orderBy'),
                    page: num(args, 'page'),
                    page_size: clamp(num(args, 'pageSize'), MAX_FORMS_PAGE),
                })}`,
            ),
    },
    {
        name: 'typeform_get_form',
        description: "Get one form's full definition: its fields (with their ids and refs), logic, settings, theme and screens. Read it before patching a form, since patch paths address this structure.",
        inputSchema: {
            type: 'object',
            properties: { formId: { type: 'string', description: 'The form id, as returned by typeform_list_forms.' } },
            required: ['formId'],
        },
        execute: async (args, token) => typeformApi(token, 'GET', `/forms/${encodeURIComponent(requireStr(args, 'formId'))}`),
    },
    {
        name: 'typeform_create_form',
        description:
            'Create a form. Only the title is required; pass "fields" to add questions in one call. The new form stays private until settings.is_public is true, so set it to publish immediately. Returns the created form, including its id and its public URL in _links.display.',
        inputSchema: {
            type: 'object',
            properties: {
                title: { type: 'string', description: 'The form title, shown in the account and used as the default page title.' },
                type: { type: 'string', enum: ['form', 'quiz', 'classification', 'score', 'other'], description: 'Form flavour. Default "form".' },
                fields: FIELDS_SCHEMA,
                settings: { type: 'object', description: 'Form settings, e.g. { is_public: true, progress_bar: "proportion", show_progress_bar: true, language: "en" }. Set is_public to true to publish the form.' },
                welcomeScreens: { type: 'array', description: 'Welcome screens, each { ref, title, properties }.', items: { type: 'object' } },
                thankYouScreens: { type: 'array', description: 'Ending screens, each { ref, title, properties }.', items: { type: 'object' } },
                variables: { type: 'object', description: 'Initial values of the form variables, e.g. { score: 0, price: 0 }.' },
                workspaceId: { type: 'string', description: 'Workspace to create the form in. Defaults to the account default workspace.' },
                themeId: { type: 'string', description: 'Theme to apply, from typeform_list_themes.' },
            },
            required: ['title'],
        },
        execute: async (args, token) => {
            const workspaceId = str(args, 'workspaceId')
            const themeId = str(args, 'themeId')
            const body: Record<string, unknown> = {
                title: requireStr(args, 'title'),
                type: str(args, 'type') ?? 'form',
                ...(objList(args, 'fields') ? { fields: objList(args, 'fields') } : {}),
                ...(obj(args, 'settings') ? { settings: obj(args, 'settings') } : {}),
                ...(objList(args, 'welcomeScreens') ? { welcome_screens: objList(args, 'welcomeScreens') } : {}),
                ...(objList(args, 'thankYouScreens') ? { thankyou_screens: objList(args, 'thankYouScreens') } : {}),
                ...(obj(args, 'variables') ? { variables: obj(args, 'variables') } : {}),
                ...(workspaceId ? { workspace: hrefOf('workspaces', workspaceId) } : {}),
                ...(themeId ? { theme: hrefOf('themes', themeId) } : {}),
            }
            return typeformApi(token, 'POST', '/forms', body)
        },
    },
    {
        name: 'typeform_update_form',
        description:
            'Edit an existing form with JSON Patch operations, leaving everything else untouched. Examples: rename with { op: "replace", path: "/title", value: "New title" }, publish with { op: "replace", path: "/settings/is_public", value: true }, append a question with { op: "add", path: "/fields/-", value: { title, type, ref } }. Call typeform_get_form first to see the paths.',
        inputSchema: {
            type: 'object',
            properties: {
                formId: { type: 'string', description: 'The form to edit.' },
                operations: {
                    type: 'array',
                    description: 'JSON Patch operations, each { op: "add" | "replace" | "remove" | "move" | "copy" | "test", path: "/settings/is_public", value: ... }.',
                    items: { type: 'object' },
                },
            },
            required: ['formId', 'operations'],
        },
        execute: async (args, token) => {
            const operations = objList(args, 'operations')
            if (!operations?.length) throw new Error('operations must contain at least one JSON Patch operation')
            return typeformApi(token, 'PATCH', `/forms/${encodeURIComponent(requireStr(args, 'formId'))}`, operations)
        },
    },
    {
        name: 'typeform_delete_form',
        description: 'Permanently delete a form and its responses. Irreversible, so confirm the form id with typeform_list_forms first.',
        inputSchema: {
            type: 'object',
            properties: { formId: { type: 'string', description: 'The form to delete.' } },
            required: ['formId'],
        },
        execute: async (args, token) => typeformApi(token, 'DELETE', `/forms/${encodeURIComponent(requireStr(args, 'formId'))}`),
    },
    {
        name: 'typeform_list_responses',
        description:
            "Read a form's submissions. Each item carries response_id, submitted_at and an answers array where every answer names the field it belongs to. Filter with since/until for a period, query for a search phrase, and paginate large forms with pageSize plus the before/after cursors.",
        inputSchema: {
            type: 'object',
            properties: {
                formId: { type: 'string', description: 'The form whose responses to read.' },
                pageSize: { type: 'number', description: `Responses per page (default 25, max ${MAX_RESPONSES_PAGE}).` },
                since: { type: 'string', description: 'Only responses submitted after this ISO 8601 datetime (e.g. 2026-03-20T14:00:59) or Unix timestamp.' },
                until: { type: 'string', description: 'Only responses submitted before this ISO 8601 datetime or Unix timestamp.' },
                after: { type: 'string', description: 'Cursor: return responses submitted after this response token (exclusive).' },
                before: { type: 'string', description: 'Cursor: return responses submitted before this response token (exclusive).' },
                responseType: { type: 'string', enum: ['completed', 'partial', 'completed,partial'], description: 'Which submissions to include. Default completed.' },
                query: { type: 'string', description: 'Search phrase matched against answers, hidden fields and variables.' },
                fields: { type: 'array', description: 'Only return the answers of these field ids.', items: { type: 'string' } },
                includedResponseIds: { type: 'array', description: 'Only return these response ids.', items: { type: 'string' } },
                sort: { type: 'string', description: 'Ordering, e.g. "submitted_at,desc" (the default).' },
            },
            required: ['formId'],
        },
        execute: async (args, token) => {
            const fields = strList(args, 'fields')
            const includedResponseIds = strList(args, 'includedResponseIds')
            return typeformApi(
                token,
                'GET',
                `/forms/${encodeURIComponent(requireStr(args, 'formId'))}/responses${query({
                    page_size: clamp(num(args, 'pageSize'), MAX_RESPONSES_PAGE),
                    since: str(args, 'since'),
                    until: str(args, 'until'),
                    after: str(args, 'after'),
                    before: str(args, 'before'),
                    response_type: str(args, 'responseType'),
                    query: str(args, 'query'),
                    fields: fields?.length ? fields.join(',') : undefined,
                    included_response_ids: includedResponseIds?.length ? includedResponseIds.join(',') : undefined,
                    sort: str(args, 'sort'),
                })}`,
            )
        },
    },
    {
        name: 'typeform_list_themes',
        description: "List the account's themes (fonts, colours, background). Use a theme id with typeform_create_form to style a new form.",
        inputSchema: {
            type: 'object',
            properties: {
                page: { type: 'number', description: 'Page number, starting at 1.' },
                pageSize: { type: 'number', description: 'Themes per page (default 10, max 200).' },
            },
        },
        execute: async (args, token) => typeformApi(token, 'GET', `/themes${query({ page: num(args, 'page'), page_size: clamp(num(args, 'pageSize'), MAX_FORMS_PAGE) })}`),
    },
    {
        name: 'typeform_list_images',
        description: "List the images stored in the account's library, with their ids and URLs, so they can be referenced from a form's fields or screens.",
        inputSchema: { type: 'object', properties: {} },
        execute: async (_args, token) => typeformApi(token, 'GET', '/images'),
    },
    {
        name: 'typeform_list_webhooks',
        description: "List a form's webhooks, with their tag, target URL and enabled state.",
        inputSchema: {
            type: 'object',
            properties: { formId: { type: 'string', description: 'The form whose webhooks to list.' } },
            required: ['formId'],
        },
        execute: async (args, token) => typeformApi(token, 'GET', `/forms/${encodeURIComponent(requireStr(args, 'formId'))}/webhooks`),
    },
    {
        name: 'typeform_upsert_webhook',
        description: 'Create or update a webhook that posts every new submission of a form to a URL. The tag is the webhook name: reusing it updates that webhook instead of adding one.',
        inputSchema: {
            type: 'object',
            properties: {
                formId: { type: 'string', description: 'The form to watch.' },
                tag: { type: 'string', description: 'Webhook name, unique per form.' },
                url: { type: 'string', description: 'HTTPS endpoint that will receive the submission payloads.' },
                enabled: { type: 'boolean', description: 'Whether submissions are delivered. Default true.' },
                secret: { type: 'string', description: 'Optional shared secret used to sign the payload (HMAC SHA256).' },
                verifySsl: { type: 'boolean', description: "Verify the endpoint's TLS certificate. Default true." },
            },
            required: ['formId', 'tag', 'url'],
        },
        execute: async (args, token) =>
            typeformApi(token, 'PUT', `/forms/${encodeURIComponent(requireStr(args, 'formId'))}/webhooks/${encodeURIComponent(requireStr(args, 'tag'))}`, {
                url: requireStr(args, 'url'),
                enabled: bool(args, 'enabled') ?? true,
                ...(str(args, 'secret') ? { secret: str(args, 'secret') } : {}),
                verify_ssl: bool(args, 'verifySsl') ?? true,
            }),
    },
    {
        name: 'typeform_delete_webhook',
        description: "Delete a form's webhook by tag.",
        inputSchema: {
            type: 'object',
            properties: {
                formId: { type: 'string', description: 'The form the webhook belongs to.' },
                tag: { type: 'string', description: 'The webhook name.' },
            },
            required: ['formId', 'tag'],
        },
        execute: async (args, token) =>
            typeformApi(token, 'DELETE', `/forms/${encodeURIComponent(requireStr(args, 'formId'))}/webhooks/${encodeURIComponent(requireStr(args, 'tag'))}`),
    },
]

export const typeformProvider: ManagedProvider = {
    id: 'typeform',
    label: 'Typeform',
    oauth: {
        authorizationEndpoint: `${TYPEFORM_BASE}/oauth/authorize`,
        tokenEndpoint: `${TYPEFORM_BASE}/oauth/token`,
        scopes: ['offline', 'accounts:read', 'forms:read', 'forms:write', 'responses:read', 'themes:read', 'images:read', 'workspaces:read', 'webhooks:read', 'webhooks:write'],
        clientIdEnv: 'RERUN_TYPEFORM_CLIENT_ID',
        clientSecretEnv: 'RERUN_TYPEFORM_CLIENT_SECRET',
        accountEmail: async accessToken => {
            const data = (await typeformApi(accessToken, 'GET', '/me').catch(() => null)) as { email?: string; alias?: string } | null
            return typeof data?.email === 'string' ? data.email : typeof data?.alias === 'string' ? data.alias : undefined
        },
    },
    tools,
}
