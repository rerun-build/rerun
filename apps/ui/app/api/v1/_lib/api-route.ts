import { AccessDeniedError, type DeniedCode } from '@/app/api/_auth/access'
import { AuthorizationError, UnauthenticatedError, requireAdminContext, requireWorkspaceContext, type WorkspaceContext } from '@/app/api/_auth/ownership'
import type { Database } from '@/app/api/database.types'
import { createClient, getRequestAccessToken } from '@/supabase/server'
import { CLIENT_HEADER, hubErrorSchema, type HubEndpoint, type HubPathParams } from '@rerun/contracts'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { z } from 'zod'
import { recordBuildDay } from '@/app/api/v1/_lib/build-days'
import { ApiError } from '@/lib/api-error'
import { AppError, refusal, type ErrorCode, type ErrorParams } from '@/lib/i18n/action-error'

// `public` is for what an app needs before anyone signs in (sign-in itself, the version gate). `user` only
// proves who is calling, for the routes a caller reaches before it has a workspace. `admin` is a member
// who runs the workspace (billing, AI providers); any other member gets a 403.
type AuthLevel = 'public' | 'user' | 'member' | 'admin'

export type UserContext = { user: User; supabase: SupabaseClient<Database> }

type ContextFor<A extends AuthLevel> = A extends 'public' ? null : A extends 'user' ? UserContext : WorkspaceContext

type RouteOptions<A extends AuthLevel, B extends z.ZodType | undefined, Q extends z.ZodType | undefined> = {
    auth: A
    body?: B
    query?: Q
}

type Infer<S> = S extends z.ZodType ? z.infer<S> : undefined

type HandlerArgs<A extends AuthLevel, B, Q> = {
    req: Request
    params: Record<string, string>
    ctx: ContextFor<A>
    body: Infer<B>
    query: Infer<Q>
}

type RouteSegment = { params: Promise<Record<string, string>> }

type EndpointBody<E extends HubEndpoint> = E['body'] extends z.ZodType ? E['body'] : undefined

type EndpointQuery<E extends HubEndpoint> = E['query'] extends z.ZodType ? E['query'] : undefined

type EndpointHandlerArgs<E extends HubEndpoint, A extends AuthLevel> = Omit<HandlerArgs<A, EndpointBody<E>, EndpointQuery<E>>, 'params'> & { params: HubPathParams<E> }

// What the handler of a mobile endpoint may hand back: what the app's schema reads, a Response it
// built itself (a refusal with its own body), or anything for a body the app never reads.
type EndpointResult<E extends HubEndpoint> = E['response'] extends z.ZodType ? z.input<E['response']> | Response : unknown

type RouteHandler = (req: Request, segment: RouteSegment) => Promise<Response>

// The endpoint a route answers for, read by the contract tests.
export type ContractRoute = RouteHandler & { endpoint?: HubEndpoint }

export { ApiError }

// The status of an action result that folded a refusal in, or the one the route would answer otherwise.
export function deniedStatus(code: DeniedCode | undefined, fallback: number): number {
    if (code === 'forbidden') return 403
    if (code === 'not_found') return 404
    return fallback
}

function errorResponse(status: number, error: string, extra?: Record<string, unknown>): Response {
    return Response.json({ error, ...extra }, { status })
}

// The English text stays what the clients that predate the codes always read.
function codedResponse(status: number, error: string, code: ErrorCode | undefined, params?: ErrorParams, extra?: Record<string, unknown>): Response {
    return errorResponse(status, error, { ...(code ? { code } : {}), ...(params ? { params } : {}), ...extra })
}

async function authenticateUser(): Promise<UserContext> {
    const supabase = await createClient()
    const { data } = await supabase.auth.getUser((await getRequestAccessToken()) ?? undefined)
    if (!data.user || data.user.is_anonymous) throw new UnauthenticatedError()
    return { user: data.user, supabase }
}

async function authenticate<A extends AuthLevel>(level: A): Promise<ContextFor<A>> {
    if (level === 'public') return null as ContextFor<A>
    if (level === 'user') return (await authenticateUser()) as ContextFor<A>
    if (level === 'admin') return (await requireAdminContext()) as ContextFor<A>
    return (await requireWorkspaceContext()) as ContextFor<A>
}

async function readBody(req: Request): Promise<unknown> {
    const text = await req.text()
    if (!text) return {}
    try {
        return JSON.parse(text)
    } catch {
        throw new ApiError(400, refusal('invalidJsonBody'))
    }
}

// Outside production, an answer the app could not read is a 500 with the reason in the log: the
// contract tests and a local run catch it before a build in the stores meets it.
const CHECK_CONTRACT = process.env.NODE_ENV !== 'production'

function contractBreach(endpoint: HubEndpoint, path: string, reason: string, detail?: unknown): Response {
    console.error(`[api/v1] ${endpoint.method} ${path} breaks the mobile contract: ${reason}`, detail ?? '')
    return errorResponse(500, 'Response breaks the mobile contract')
}

async function checkedResponse(endpoint: HubEndpoint, path: string, res: Response): Promise<Response> {
    if (res.status === endpoint.emptyStatus) return res
    if (!res.ok) {
        const schema = endpoint.errors?.[res.status] ?? hubErrorSchema
        const parsed = schema.safeParse(await res.clone().json().catch(() => undefined))
        return parsed.success ? res : contractBreach(endpoint, path, `the ${res.status} body`, parsed.error.issues)
    }
    if (res.status !== endpoint.status) return contractBreach(endpoint, path, `status ${res.status} instead of ${endpoint.status}`)
    if (typeof endpoint.response === 'string') return res
    const parsed = endpoint.response.safeParse(await res.clone().json().catch(() => undefined))
    return parsed.success ? res : contractBreach(endpoint, path, 'the body', parsed.error.issues)
}

function resultResponse(result: unknown): Response {
    if (result instanceof Response) return result
    if (result === undefined) return new Response(null, { status: 204 })
    return Response.json(result)
}

type Route = { auth: AuthLevel; body?: z.ZodType; query?: z.ZodType; endpoint?: HubEndpoint }

function route(options: Route, handler: (args: HandlerArgs<AuthLevel, z.ZodType | undefined, z.ZodType | undefined>) => Promise<unknown>): ContractRoute {
    const { endpoint } = options
    const answer: ContractRoute = async (req, segment) => {
        const client = req.headers.get(CLIENT_HEADER)
        const path = `${new URL(req.url).pathname}${client ? ` [${client}]` : ''}`
        let ctx: ContextFor<AuthLevel>
        try {
            ctx = await authenticate(options.auth)
        } catch (err) {
            if (err instanceof UnauthenticatedError) return codedResponse(401, 'Unauthorized', 'notAuthenticated')
            if (err instanceof AuthorizationError) return codedResponse(403, err.message, err.code, err.params)
            console.error(`[api/v1] ${req.method} ${path} auth failed`, err)
            return codedResponse(500, 'Internal error', 'generic')
        }
        if (ctx) recordBuildDay(req, 'user' in ctx ? ctx.user.id : ctx.userId)

        let res: Response
        try {
            const body = options.body ? options.body.parse(await readBody(req)) : undefined
            const query = options.query ? options.query.parse(Object.fromEntries(new URL(req.url).searchParams)) : undefined
            const params = (await segment.params) ?? {}
            res = resultResponse(await handler({ req, params, ctx, body, query }))
        } catch (err) {
            if (err instanceof z.ZodError) return codedResponse(400, 'Invalid request', 'invalidRequest', undefined, { issues: err.issues })
            if (err instanceof ApiError) return codedResponse(err.status, err.message, err.code, err.params)
            // Both are AppErrors too: they keep the statuses the app tells apart, ahead of the 422.
            // Reached, but the caller only uses this Box and the route changes it.
            if (err instanceof AccessDeniedError) return codedResponse(403, err.message, err.code, err.params)
            // Past authentication, a resource outside the caller's workspace or Boxes reads as missing.
            if (err instanceof AuthorizationError) return codedResponse(404, 'Not found', 'notFound')
            // A refusal meant for the person, in English for the clients that predate the codes.
            if (err instanceof AppError) return codedResponse(422, err.message, err.code, err.params)
            console.error(`[api/v1] ${req.method} ${path} failed`, err)
            return codedResponse(500, 'Internal error', 'generic')
        }
        return endpoint && CHECK_CONTRACT ? checkedResponse(endpoint, path, res) : res
    }
    answer.endpoint = endpoint
    return answer
}

// A call of the mobile app: its body, query and parameters come from the registry, and what the
// handler answers is typed by the schema the app reads it with.
export function apiRoute<E extends HubEndpoint, A extends AuthLevel>(endpoint: E, options: { auth: A }, handler: (args: EndpointHandlerArgs<E, A>) => Promise<EndpointResult<E>>): ContractRoute
export function apiRoute<A extends AuthLevel, B extends z.ZodType | undefined = undefined, Q extends z.ZodType | undefined = undefined>(options: RouteOptions<A, B, Q>, handler: (args: HandlerArgs<A, B, Q>) => Promise<unknown>): ContractRoute
export function apiRoute(first: HubEndpoint | RouteOptions<AuthLevel, z.ZodType | undefined, z.ZodType | undefined>, second: unknown, third?: unknown): ContractRoute {
    if ('method' in first) {
        const { auth } = second as { auth: AuthLevel }
        const body = first.body === 'bytes' ? undefined : first.body
        return route({ auth, body, query: first.query, endpoint: first }, third as Parameters<typeof route>[1])
    }
    return route(first, second as Parameters<typeof route>[1])
}
