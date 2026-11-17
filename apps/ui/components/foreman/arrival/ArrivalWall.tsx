'use client'

import { PhoneVerificationStep } from '@rerun/cloud/phone.client'

// The phone code, asked in the column rather than in a dialog over the board: what they picked
// stays in sight the whole way. It is the form the phone wall mounts.
export function ArrivalWall() {
    return (
        <div className="flex flex-col gap-6">
            <PhoneVerificationStep active />
        </div>
    )
}
