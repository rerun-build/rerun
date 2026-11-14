import { ApiError } from '@/app/api/v1/_lib/api-route'

export const ENGINE_PATH_ID = /^[\w-]+$/

export function assertPathId(value: string, notFound: string): string {
    if (!ENGINE_PATH_ID.test(value)) throw new ApiError(404, notFound)
    return value
}
