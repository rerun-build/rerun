import { AccessDeniedError, type DeniedCode } from '@/app/api/_auth/access'
import { AuthorizationError, UnauthenticatedError, requireAdminContext, requireWorkspaceContext, type WorkspaceContext } from '@/app/api/_auth/ownership'
import type { Database } from '@/app/api/database.types'
import { createClient, getRequestAccessToken } from '@/supabase/server'
import { CLIENT_HEADER } from '@rerun/contracts'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { z } from 'zod'
import { ApiError } from '@/lib/api-error'
import { AppError } from '@/lib/i18n/action-error'

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
        throw new ApiError(400, 'Invalid JSON body')
    }
}

export function apiRoute<A extends AuthLevel, B extends z.ZodType | undefined = undefined, Q extends z.ZodType | undefined = undefined>(
    options: RouteOptions<A, B, Q>,
    handler: (args: HandlerArgs<A, B, Q>) => Promise<unknown>
) {
    return async (req: Request, segment: RouteSegment): Promise<Response> => {
        const client = req.headers.get(CLIENT_HEADER)
        const path = `${new URL(req.url).pathname}${client ? ` [${client}]` : ''}`
        let ctx: ContextFor<A>
        try {
            ctx = await authenticate(options.auth)
        } catch (err) {
            if (err instanceof UnauthenticatedError) return errorResponse(401, 'Unauthorized')
            if (err instanceof AuthorizationError) return errorResponse(403, err.message)
            console.error(`[api/v1] ${req.method} ${path} auth failed`, err)
            return errorResponse(500, 'Internal error')
        }

        try {
            const body = (options.body ? options.body.parse(await readBody(req)) : undefined) as Infer<B>
            const query = (options.query ? options.query.parse(Object.fromEntries(new URL(req.url).searchParams)) : undefined) as Infer<Q>
            const params = (await segment.params) ?? {}
            const result = await handler({ req, params, ctx, body, query })
            if (result instanceof Response) return result
            if (result === undefined) return new Response(null, { status: 204 })
            return Response.json(result)
        } catch (err) {
            if (err instanceof z.ZodError) return errorResponse(400, 'Invalid request', { issues: err.issues })
            if (err instanceof ApiError) return errorResponse(err.status, err.message)
            // A refusal meant for the person, in English for the clients that predate the codes.
            if (err instanceof AppError) return errorResponse(422, err.message, { code: err.code, ...(err.params ? { params: err.params } : {}) })
            // Reached, but the caller only uses this Box and the route changes it.
            if (err instanceof AccessDeniedError) return errorResponse(403, err.message)
            // Past authentication, a resource outside the caller's workspace or Boxes reads as missing.
            if (err instanceof AuthorizationError) return errorResponse(404, 'Not found')
            console.error(`[api/v1] ${req.method} ${path} failed`, err)
            return errorResponse(500, 'Internal error')
        }
    }
}
