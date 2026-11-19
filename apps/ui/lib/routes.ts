export const routes = {
    home: '/',
    board: '/board',
    auth: '/auth',
    authCallback: '/auth/callback',
    authCodeError: '/auth/auth-code-error',
    app: process.env.NEXT_PUBLIC_APP_URL || 'https://moldwright.robagentic.tech',
} as const
