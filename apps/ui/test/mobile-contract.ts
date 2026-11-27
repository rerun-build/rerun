import { hubErrorSchema, hubPath, type HubEndpoint, type HubPathParams, type HubQueryValues } from '@rerun/contracts'
import { parseJsonEventStream, uiMessageChunkSchema, type UIMessageChunk } from 'ai'
import { expect } from 'vitest'

import type { WorkspaceContext } from '@/app/api/_auth/ownership'
import type { getSessionWorkspace } from '@/supabase/session/getServerSession'
import type { FakeSupabase } from '@/test/supabase-fake'
import { z } from 'zod'

function readable(endpoint: HubEndpoint, what: string, schema: z.ZodType, value: unknown): unknown {
    const parsed = schema.safeParse(value)
    if (!parsed.success) throw new Error(`${endpoint.method} ${endpoint.path}: the app cannot read ${what}\n${z.prettifyError(parsed.error)}\n${JSON.stringify(value, null, 2)}`)
    return parsed.data
}

// Every chunk read as the app's chat transport reads it, with the AI SDK's own schema: one it does not
// know fails the whole stream in the app.
async function readStream(endpoint: HubEndpoint, res: Response): Promise<UIMessageChunk[]> {
    expect(res.headers.get('content-type'), `${endpoint.path} content type`).toMatch(/^text\/event-stream/)
    if (!res.body) throw new Error(`${endpoint.method} ${endpoint.path}: a stream without a body`)
    const chunks: UIMessageChunk[] = []
    const reader = parseJsonEventStream({ stream: res.body, schema: uiMessageChunkSchema }).getReader()
    for (let next = await reader.read(); !next.done; next = await reader.read()) {
        if (!next.value.success) throw new Error(`${endpoint.method} ${endpoint.path}: the app cannot read the chunk ${JSON.stringify(next.value.rawValue)}\n${next.value.error.message}`)
        chunks.push(next.value.value)
    }
    return chunks
}

// The answer of a route, read the way the mobile app reads it, and handed back as it read it. Without
// `failure`, a success: the status the registry promises, its headers, its body. With it, that failure
// and the body the app reads for its status.
export async function expectContract(endpoint: HubEndpoint, res: Response, failure?: number): Promise<unknown> {
    if (failure !== undefined) {
        expect(res.status, `${endpoint.method} ${endpoint.path} status`).toBe(failure)
        return readable(endpoint, `the ${res.status} body`, endpoint.errors?.[res.status] ?? hubErrorSchema, await res.json().catch(() => undefined))
    }
    if (res.status === endpoint.emptyStatus) return undefined
    if (!res.ok) throw new Error(`${endpoint.method} ${endpoint.path}: expected a success, got ${res.status} ${await res.text()}`)
    expect(res.status, `${endpoint.method} ${endpoint.path} status`).toBe(endpoint.status)
    for (const header of endpoint.headers ?? []) expect(res.headers.get(header), `${endpoint.method} ${endpoint.path} header ${header}`).toBeTruthy()
    if (endpoint.response === 'none') return undefined
    if (endpoint.response === 'bytes') return new Uint8Array(await res.arrayBuffer())
    if (endpoint.response === 'ui-message-stream') return readStream(endpoint, res)
    return readable(endpoint, 'the body', endpoint.response, await res.json())
}

type RouteHandler = (req: Request, segment: { params: Promise<Record<string, string>> }) => Promise<Response>

export type ContractCall<E extends HubEndpoint> = {
    params?: HubPathParams<E>
    query?: HubQueryValues
    body?: unknown
    // The build that calls, as the app names itself: `ios/1.0.2 (38)`.
    client?: string
    headers?: Record<string, string>
}

// The call the app makes to one endpoint, sent to the route that answers it: the method, path and
// query of the registry, a JSON body or raw bytes, and the app's own headers.
export function callRoute<E extends HubEndpoint>(handler: RouteHandler, endpoint: E, { params, query, body, client = 'ios/1.0.2 (38)', headers: extra }: ContractCall<E> = {}): Promise<Response> {
    const values = (params ?? {}) as Record<string, string>
    const headers: Record<string, string> = { 'x-rerun-client': client, authorization: 'Bearer token', 'x-workspace-id': '7', ...extra }
    let payload: BodyInit | undefined
    if (body instanceof Uint8Array) {
        headers['content-type'] = 'application/octet-stream'
        payload = new Blob([body as Uint8Array<ArrayBuffer>])
    } else if (body !== undefined) {
        headers['content-type'] = 'application/json'
        payload = JSON.stringify(body)
    }
    const req = new Request(`https://app.rerun.build${hubPath(endpoint, values as HubPathParams<E>, query)}`, { method: endpoint.method, headers, body: payload })
    return handler(req, { params: Promise.resolve(values) })
}

export const CONTRACT_WORKSPACE = {
    id: 7,
    name: 'Atelier Nord',
    icon_url: null,
    created_at: '2026-11-02T09:00:00.000Z',
    plan: 'pro',
    stripe_customer_id: null,
    max_agents: 10,
    max_seats: 5,
    model_access: 'all',
    custom_integrations: true,
    api_access: true,
    lifetime_tier: null,
    subscription_status: 'active',
    current_period_end: '2026-12-19T09:00:00.000Z',
    trial_ends_at: null,
    rerun_used_micros: 0,
    rerun_budget_micros: 0,
    rerun_topup_micros: 0,
    rerun_period_anchor: null,
    rerun_credit_paused_at: null,
    is_sandbox: false,
    boxes_disabled_at: null,
    boxes_archived_at: null,
    onboarded_at: '2026-11-02T09:00:00.000Z',
    locale: 'en',
    organization_id: null,
} satisfies WorkspaceContext['workspace']

type SessionUser = NonNullable<Awaited<ReturnType<typeof getSessionWorkspace>>['user']>

// The caller's `users` row as a session holds it, for the tests that stand in for the session.
export function contractSessionUser(id: string, workspaceId: number): SessionUser {
    return { id, created_at: '2026-11-02T09:00:00.000Z', workspace_id: workspaceId, email_notification_prefs: null, account_role: 'member', expert_profile_id: null, signed_up_at: '2026-11-02T09:00:00.000Z', locale: null }
}

// The caller the routes run for: an admin of workspace 7 unless told otherwise, reading through the
// fake database of the test.
export function contractContext(db: FakeSupabase, overrides: Partial<WorkspaceContext> = {}): WorkspaceContext {
    return {
        userId: 'user-ada',
        userEmail: 'ada@atelier-nord.fr',
        userLocale: null,
        authUser: { id: 'user-ada', email: 'ada@atelier-nord.fr', is_anonymous: false, user_metadata: { full_name: 'Ada Lovelace', avatar_url: 'https://cdn.rerun.build/avatars/ada.png' }, app_metadata: {} },
        workspace: CONTRACT_WORKSPACE,
        role: 'admin',
        boxScope: 'all',
        supabase: db.client,
        ...overrides,
    }
}
