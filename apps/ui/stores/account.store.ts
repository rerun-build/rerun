import { create } from 'zustand'

export type AccountTab = 'profile' | 'sign-in' | 'language' | 'desktop' | 'delete'

// The sign-in tab can open straight on its phone editor, for the getting-started step that asks for it.
export type AccountSignInStart = 'list' | 'phone'

type AccountState = {
    open: boolean
    tab: AccountTab
    signInStart: AccountSignInStart
    openAccount: (tab?: AccountTab, signInStart?: AccountSignInStart) => void
    setOpen: (open: boolean) => void
    setTab: (tab: AccountTab) => void
}

export const useAccountStore = create<AccountState>(set => ({
    open: false,
    tab: 'profile',
    signInStart: 'list',
    openAccount: (tab, signInStart) => set({ open: true, tab: tab ?? 'profile', signInStart: signInStart ?? 'list' }),
    setOpen: open => set({ open }),
    setTab: tab => set({ tab, signInStart: 'list' }),
}))
