import { AppError, type ErrorCode, type ErrorParams } from '@/lib/i18n/action-error'

export class AuthorizationError extends AppError {
    constructor(code: ErrorCode = 'notAuthorized', params?: ErrorParams) {
        super(code, params)
        this.name = 'AuthorizationError'
    }
}

export class UnauthenticatedError extends AuthorizationError {
    constructor() {
        super('notAuthenticated')
        this.name = 'UnauthenticatedError'
    }
}
