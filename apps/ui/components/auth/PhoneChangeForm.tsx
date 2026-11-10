'use client'

import { useErrorText } from '@/hooks/useErrorText'
import { sendPhoneChangeCodeAction, verifyPhoneChangeCodeAction } from '@/app/api/_actions/phone.actions'
import { PhoneCodeForm, type PhoneCodeRequest } from '@/components/auth/PhoneCodeForm'
import { sendPhoneCode } from '@/components/auth/phone-send'

// Adds or replaces the number of the signed-in account, from the account dialog.
export function PhoneChangeForm({ onChanged }: { onChanged: () => Promise<void> }) {
    const errorText = useErrorText()
    const sendNewPhoneCode = (request: PhoneCodeRequest) => sendPhoneCode('settings', request, () => sendPhoneChangeCodeAction(request))

    const verifyPhoneCode = async (code: string, request: PhoneCodeRequest) => {
        const result = await verifyPhoneChangeCodeAction({ ...request, code })
        if (!result.ok) throw new Error(errorText(result))
        await onChanged()
    }

    return <PhoneCodeForm persistKey="phone-change" sendCode={sendNewPhoneCode} verifyCode={verifyPhoneCode} />
}
