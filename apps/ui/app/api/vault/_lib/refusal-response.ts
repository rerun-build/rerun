import { AuthorizationError, UnauthenticatedError } from '@/app/api/_auth/errors'
import { ApiError } from '@/lib/api-error'
import { type ErrorCode, refusalOf } from '@/lib/i18n/action-error'
import { NextResponse } from 'next/server'

export function refusalResponse(err: unknown, fallback: ErrorCode): NextResponse {
    const status = err instanceof ApiError ? err.status : err instanceof UnauthenticatedError ? 401 : err instanceof AuthorizationError ? 403 : 400
    const body = err instanceof ApiError ? { error: err.message, ...(err.code ? { code: err.code } : {}), ...(err.params ? { params: err.params } : {}) } : refusalOf(err, fallback)
    return NextResponse.json(body, { status })
}
