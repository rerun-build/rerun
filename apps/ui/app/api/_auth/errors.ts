import { AppError, type ErrorCode, type ErrorParams } from '@/lib/i18n/action-error'

// Thrown when the caller is unauthenticated or targets a resource outside their
// workspace. Most callers swallow it to fail closed (empty/null result); the
// ones that throw surface a generic "not found" so we don't leak existence.
export class AuthorizationError extends AppError {
    constructor(code: ErrorCode = 'notAuthorized', params?: ErrorParams) {
        super(code, params)
        this.name = 'AuthorizationError'
    }
}

// No caller identity at all, as opposed to an identity that may not touch the resource. The API
// answers the first with a 401 so the app refreshes its token, the second with a 404.
export class UnauthenticatedError extends AuthorizationError {
    constructor() {
        super('notAuthenticated')
        this.name = 'UnauthenticatedError'
    }
}
