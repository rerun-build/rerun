import { ApiError } from '@/app/api/v1/_lib/api-route'
import { refusal, type ErrorCode } from '@/lib/i18n/action-error'

// An id that lands in a path to the engine (a run, a task, a routine's slug) is a word: anything else
// could reach another route of the engine with the box's own key. Checked at the door, as a 404.
export const ENGINE_PATH_ID = /^[\w-]+$/

export function assertPathId(value: string, notFound: ErrorCode): string {
    if (!ENGINE_PATH_ID.test(value)) throw new ApiError(404, refusal(notFound))
    return value
}
