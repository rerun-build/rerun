import { z } from 'zod'

export const HUB_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const
export type HubMethod = (typeof HUB_METHODS)[number]

// What a call answers when it works. A schema is a JSON body the app reads with it; `none` a body it
// never reads (204, or JSON it ignores); `ui-message-stream` the AI SDK stream of a chat; `bytes` a file.
export type HubReply = z.ZodType | 'none' | 'ui-message-stream' | 'bytes'

// One call the mobile app makes to the hub. Every build in the stores keeps the schemas it was
// compiled with, so what is written here is a promise to all of them: see apps/mobile/api-contract.
export type HubEndpoint = {
    method: HubMethod
    // Parameters in braces, named as the hub's route folders name them: `/api/v1/agents/{id}`.
    path: `/api/${string}`
    // A JSON body, or the raw bytes of a file.
    body?: z.ZodType | 'bytes'
    query?: z.ZodObject
    response: HubReply
    // The status of a success: 200 for a JSON body, 204 for none, unless the route says otherwise.
    status: number
    // The headers of a success the app reads.
    headers?: readonly string[]
    // The failures the app tells apart, with the body it reads from them. Any other one is a hubError.
    errors?: Readonly<Partial<Record<number, z.ZodType>>>
}

// The body of every failure: the app shows `error` when it has nothing better to say.
export const hubErrorSchema = z.looseObject({ error: z.string() })
export type HubError = z.infer<typeof hubErrorSchema>

type EndpointInput = Omit<HubEndpoint, 'status'> & { status?: number }

type WithStatus<E extends EndpointInput> = Omit<E, 'status'> & { status: number }

export function hubEndpoint<const E extends EndpointInput>(endpoint: E): WithStatus<E> {
    return { ...endpoint, status: endpoint.status ?? (endpoint.response === 'none' ? 204 : 200) }
}

type ParamNames<P extends string> = P extends `${string}{${infer Name}}${infer Rest}` ? Name | ParamNames<Rest> : never

export type HubPathParams<E extends Pick<HubEndpoint, 'path'>> = { [Name in ParamNames<E['path']>]: string }

export type HubBody<E extends HubEndpoint> = E['body'] extends z.ZodType ? z.input<E['body']> : E['body'] extends 'bytes' ? Blob : undefined

export type HubQuery<E extends HubEndpoint> = E['query'] extends z.ZodObject ? z.input<E['query']> : undefined

export type HubResponse<E extends HubEndpoint> = E['response'] extends z.ZodType ? z.output<E['response']> : void
