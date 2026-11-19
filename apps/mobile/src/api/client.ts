import { CLIENT_HEADER, formatClientHeader, hubPath, isRecord, type HubBody, type HubEndpoint, type HubPathParams, type HubQuery, type HubQueryValues, type HubResponse } from '@rerun/contracts'
import * as Application from 'expo-application'

import { readSalvaging, type ResponseSchema } from '@/api/salvage'
import { environment } from '@/config/environment'
import type { MobileMessages } from '@/i18n/messages'
import { translatorFor } from '@/i18n/translator'
import { clientPlatform } from '@/lib/client-platform'

const WORKSPACE_HEADER = 'x-workspace-id'

type ErrorCode = keyof Omit<MobileMessages['errors'], '_context'>
type ErrorParams = Record<string, string | number>

export class ApiError extends Error {
    constructor(
        readonly status: number,
        message: string,
        readonly body: unknown = null,
        readonly code: string | null = null,
        readonly params: ErrorParams | null = null
    ) {
        super(message)
        this.name = 'ApiError'
    }
}

export type ApiRequest = {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
    body?: unknown
    accessToken?: string | null
    workspaceId?: number | null
    signal?: AbortSignal
}

type ApiClientConfig = { baseUrl: string; clientHeader: string; fetch?: typeof fetch }

function stringFieldOf(payload: unknown, field: 'error' | 'code'): string | null {
    if (!isRecord(payload)) return null
    const value = payload[field]
    return typeof value === 'string' ? value : null
}

function paramsOf(payload: unknown): ErrorParams | null {
    return isRecord(payload) && isRecord(payload.params) ? (payload.params as ErrorParams) : null
}

// Only a code this build's `errors` catalog knows is translated: a hub deployed ahead of the app may
// send one it has never heard of, which then reads in the hub's English.
function translatedRefusal(code: string | null, params: ErrorParams | null): string | null {
    if (!code || code === '_context') return null
    const t = translatorFor('errors')
    const key = code as ErrorCode
    return t.has(key) ? t(key, (params ?? undefined) as never) : null
}

export function apiErrorOf(status: number, payload: unknown, fallback: string): ApiError {
    const code = stringFieldOf(payload, 'code')
    const params = paramsOf(payload)
    return new ApiError(status, translatedRefusal(code, params) ?? stringFieldOf(payload, 'error') ?? fallback, payload, code, params)
}

// What every call to the hub carries: the build, and once signed in the token and the workspace.
export function hubHeaders(clientHeader: string, { accessToken, workspaceId }: Pick<ApiRequest, 'accessToken' | 'workspaceId'>): Record<string, string> {
    const headers: Record<string, string> = { [CLIENT_HEADER]: clientHeader }
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`
    if (workspaceId != null) headers[WORKSPACE_HEADER] = String(workspaceId)
    return headers
}

const failureOf = (status: number, payload: unknown) => apiErrorOf(status, payload, translatorFor('mobileCommon')('errors.requestFailed', { status }))

export type ApiClient = <T>(path: string, request?: ApiRequest) => Promise<T>

export function createApiClient({ baseUrl, clientHeader, fetch: fetchImpl = fetch }: ApiClientConfig): ApiClient {
    return async function request<T>(path: string, { method = 'GET', body, accessToken, workspaceId, signal }: ApiRequest = {}): Promise<T> {
        const headers: Record<string, string> = { Accept: 'application/json', ...hubHeaders(clientHeader, { accessToken, workspaceId }) }
        if (body !== undefined) headers['Content-Type'] = 'application/json'

        const res = await fetchImpl(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal })
        if (res.status === 204) return undefined as T

        const payload: unknown = await res.json().catch(() => null)
        if (!res.ok) throw failureOf(res.status, payload)
        return payload as T
    }
}

// What a read the app may already hold answered: `payload` is null when the hub said it has not
// changed since `etag` (a 304), and `headers` are the response's.
export type ConditionalRead<T> = { payload: T | null; etag: string | null; headers: Headers }

export function createConditionalReader({ baseUrl, clientHeader, fetch: fetchImpl = fetch }: ApiClientConfig) {
    return async function read<T>(path: string, { accessToken, workspaceId, etag }: Pick<ApiRequest, 'accessToken' | 'workspaceId'> & { etag: string | null }): Promise<ConditionalRead<T>> {
        const headers: Record<string, string> = { Accept: 'application/json', ...hubHeaders(clientHeader, { accessToken, workspaceId }) }
        if (etag) headers['If-None-Match'] = etag
        const res = await fetchImpl(`${baseUrl}${path}`, { headers })
        if (res.status === 304) return { payload: null, etag, headers: res.headers }
        const payload: unknown = await res.json().catch(() => null)
        if (!res.ok) throw failureOf(res.status, payload)
        return { payload: payload as T, etag: res.headers.get('etag'), headers: res.headers }
    }
}

// A call that answers JSON, or nothing the app reads. Streams and files go through their own paths.
type JsonEndpoint = HubEndpoint & { response: Exclude<HubEndpoint['response'], 'ui-message-stream' | 'bytes'>; body?: Exclude<HubEndpoint['body'], 'bytes'> }

type HubCall<E extends JsonEndpoint> = Pick<ApiRequest, 'accessToken' | 'workspaceId' | 'signal'> &
    ([keyof HubPathParams<E>] extends [never] ? { params?: undefined } : { params: HubPathParams<E> }) &
    (HubBody<E> extends undefined ? { body?: undefined } : { body: HubBody<E> }) &
    (HubQuery<E> extends undefined ? { query?: undefined } : { query?: HubQuery<E> })

type AnyCall = Pick<ApiRequest, 'accessToken' | 'workspaceId' | 'signal'> & { params?: Record<string, string>; body?: unknown; query?: HubQueryValues }

type OnSalvage = (call: string, dropped: string[]) => void

type HubClientOptions = { onSalvage?: OnSalvage }

// Said once per call for as long as the app runs: a call the app repeats (the skill proposals, every
// 1.5 s) would otherwise say it again at every answer, from a build nobody can fix any more.
function reportingOnce(onSalvage: OnSalvage | undefined): OnSalvage | undefined {
    if (!onSalvage) return undefined
    const reported = new Set<string>()
    return (call, dropped) => {
        if (reported.has(call)) return
        reported.add(call)
        onSalvage(call, dropped)
    }
}

// One call of the registry: its method and path, and its answer read with the schema the hub promised,
// leaving out what this build cannot read rather than failing the whole answer (salvage.ts).
export function createHubClient(request: ApiClient, options: HubClientOptions = {}) {
    const onSalvage = reportingOnce(options.onSalvage)
    return async function hub<E extends JsonEndpoint>(endpoint: E, call: HubCall<E>): Promise<HubResponse<E>> {
        const { params, body, query, accessToken, workspaceId, signal } = call as AnyCall
        const payload = await request<unknown>(hubPath(endpoint, (params ?? {}) as HubPathParams<E>, query), { method: endpoint.method, body, accessToken, workspaceId, signal })
        return readAnswer(endpoint, payload, onSalvage)
    }
}

function readAnswer<E extends JsonEndpoint>(endpoint: E, payload: unknown, onSalvage: OnSalvage | undefined): HubResponse<E> {
    if (typeof endpoint.response === 'string') return undefined as HubResponse<E>
    const { data, dropped } = readSalvaging(endpoint.response as ResponseSchema, payload)
    if (dropped.length) onSalvage?.(`${endpoint.method} ${endpoint.path}`, dropped)
    return data as HubResponse<E>
}

type ConditionalReader = ReturnType<typeof createConditionalReader>

// A read of the registry the app may already hold: the answer read with its schema, or a null
// `payload` when the hub said it is still the one named by `etag`.
export function createConditionalHubReader(read: ConditionalReader, options: HubClientOptions = {}) {
    const onSalvage = reportingOnce(options.onSalvage)
    return async function hubConditional<E extends JsonEndpoint>(endpoint: E, call: HubCall<E> & { etag: string | null }): Promise<ConditionalRead<HubResponse<E>>> {
        const { params, query, accessToken, workspaceId, etag } = call as AnyCall & { etag: string | null }
        const answer = await read<unknown>(hubPath(endpoint, (params ?? {}) as HubPathParams<E>, query), { accessToken, workspaceId, etag })
        const payload = answer.payload === null ? null : readAnswer(endpoint, answer.payload, onSalvage)
        return { ...answer, payload }
    }
}

export const appBuild = Number(Application.nativeBuildVersion ?? 0)

export const clientHeader = formatClientHeader({ platform: clientPlatform, version: Application.nativeApplicationVersion ?? '0.0.0', build: appBuild })

const api = createApiClient({ baseUrl: environment.apiUrl, clientHeader })

const salvage: HubClientOptions = {
    onSalvage: (call, dropped) => {
        console.warn(`[hub] ${call}: left out ${dropped.join(', ')}`)
        // Loaded only then: the client stays clear of the analytics SDK it seldom needs.
        void import('@/lib/analytics').then(({ track }) => track('api_answer_salvaged', { call, dropped: dropped.length }))
    },
}

export const hub = createHubClient(api, salvage)

export const hubConditional = createConditionalHubReader(createConditionalReader({ baseUrl: environment.apiUrl, clientHeader }), salvage)
