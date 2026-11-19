import { CLIENT_HEADER, formatClientHeader, isRecord } from '@rerun/contracts'
import * as Application from 'expo-application'

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

export function createApiClient({ baseUrl, clientHeader, fetch: fetchImpl = fetch }: ApiClientConfig) {
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

export const appBuild = Number(Application.nativeBuildVersion ?? 0)

export const clientHeader = formatClientHeader({ platform: clientPlatform, version: Application.nativeApplicationVersion ?? '0.0.0', build: appBuild })

export const api = createApiClient({ baseUrl: environment.apiUrl, clientHeader })

export const apiConditional = createConditionalReader({ baseUrl: environment.apiUrl, clientHeader })
