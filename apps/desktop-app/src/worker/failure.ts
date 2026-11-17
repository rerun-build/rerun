import type { RemoteErrorCode } from '@rerun/contracts'

// A refusal or a failure sent back to the engine with its code, which the coworker reads.
export class RemoteFailure extends Error {
    constructor(
        readonly code: RemoteErrorCode,
        message: string,
    ) {
        super(message)
        this.name = 'RemoteFailure'
    }
}
