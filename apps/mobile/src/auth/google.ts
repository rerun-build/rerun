import { GoogleSignin, isErrorWithCode, isSuccessResponse, statusCodes } from '@react-native-google-signin/google-signin'
import { Platform } from 'react-native'

import { SignInError } from '@/auth/sign-in'
import { supabase } from '@/auth/supabase'

const IOS_CLIENT_ID = '530380179314-likpnhr06isv0ucqs86c4bgpt0oi91c5.apps.googleusercontent.com'
const WEB_CLIENT_ID = '530380179314-b1vb2v1gkvvm2tes84ni2kd3s7u5k48a.apps.googleusercontent.com'

GoogleSignin.configure(Platform.OS === 'android' ? { webClientId: WEB_CLIENT_ID } : { iosClientId: IOS_CLIENT_ID })

const FAILED = 'We could not sign you in with Google. Try again.'

export async function signInWithGoogle(): Promise<boolean> {
    let idToken: string | null
    try {
        const response = await GoogleSignin.signIn()
        if (!isSuccessResponse(response)) return false
        idToken = response.data.idToken
    } catch (error) {
        if (isErrorWithCode(error) && error.code === statusCodes.IN_PROGRESS) return false
        throw new SignInError(FAILED, 'google')
    }
    if (!idToken) throw new SignInError(FAILED, 'google')

    const { error } = await supabase.auth.signInWithIdToken({ provider: 'google', token: idToken })
    if (error) throw new SignInError(FAILED, 'google')
    return true
}

export async function forgetGoogleAccount() {
    await GoogleSignin.signOut().catch(() => {})
}
