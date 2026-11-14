export type CaptchaWidget = {
    getToken: () => Promise<string>
    remove: () => void
}

export type Waiter = { resolve: (token: string) => void; reject: (error: Error) => void }
