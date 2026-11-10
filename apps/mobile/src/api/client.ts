import { CLIENT_HEADER, formatClientHeader } from '@rerun/contracts'
import * as Application from 'expo-application'

import { environment } from '@/config/environment'
import { translatorFor } from '@/i18n/translator'
import { clientPlatform } from '@/lib/client-platform'

const WORKSPACE_HEADER = 'x-workspace-id'

export class ApiError extends Error {
    constructor(
        readonly status: number,
        message: string,
        readonly body: unknown = null
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

function errorMessageOf(payload: unknown): string | null {
    if (typeof payload !== 'object' || payload === null || !('error' in payload)) return null
    return typeof payload.error === 'string' ? payload.error : null
}

// What every call to the hub carries: the build, and once signed in the token and the workspace.
export function hubHeaders(clientHeader: string, { accessToken, workspaceId }: Pick<ApiRequest, 'accessToken' | 'workspaceId'>): Record<string, string> {
    const headers: Record<string, string> = { [CLIENT_HEADER]: clientHeader }
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`
    if (workspaceId != null) headers[WORKSPACE_HEADER] = String(workspaceId)
    return headers
}

export function createApiClient({ baseUrl, clientHeader, fetch: fetchImpl = fetch }: ApiClientConfig) {
    return async function request<T>(path: string, { method = 'GET', body, accessToken, workspaceId, signal }: ApiRequest = {}): Promise<T> {
        const headers: Record<string, string> = { Accept: 'application/json', ...hubHeaders(clientHeader, { accessToken, workspaceId }) }
        if (body !== undefined) headers['Content-Type'] = 'application/json'

        const res = await fetchImpl(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal })
        if (res.status === 204) return undefined as T

        const payload: unknown = await res.json().catch(() => null)
        if (!res.ok) throw new ApiError(res.status, errorMessageOf(payload) ?? translatorFor('mobileCommon')('errors.requestFailed', { status: res.status }), payload)
        return payload as T
    }
}

export const appBuild = Number(Application.nativeBuildVersion ?? 0)

export const clientHeader = formatClientHeader({ platform: clientPlatform, version: Application.nativeApplicationVersion ?? '0.0.0', build: appBuild })

export const api = createApiClient({ baseUrl: environment.apiUrl, clientHeader })
