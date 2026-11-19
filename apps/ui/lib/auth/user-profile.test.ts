import { describe, expect, it } from 'vitest'

import { displayNameOf, readProfile } from './user-profile'

const google = { full_name: 'Ada Google', avatar_url: 'https://lh3.googleusercontent.com/ada' }

describe('readProfile', () => {
    it('reads what Google wrote while the account chose nothing', () => {
        expect(readProfile({ app_metadata: { provider: 'google' }, user_metadata: google })).toEqual({ name: 'Ada Google', avatarUrl: 'https://lh3.googleusercontent.com/ada' })
    })

    it('puts the name and the photo the account chose ahead of the ones Google keeps rewriting', () => {
        const chosen = { full_name: 'Ada Lovelace', avatar_url: 'https://cdn.rerun.build/user-avatars/ada.webp' }

        expect(readProfile({ app_metadata: chosen, user_metadata: google })).toEqual({ name: 'Ada Lovelace', avatarUrl: 'https://cdn.rerun.build/user-avatars/ada.webp' })
    })

    it('shows no photo once it was removed, even when Google holds one', () => {
        expect(readProfile({ app_metadata: { avatar_url: '' }, user_metadata: google })).toEqual({ name: 'Ada Google', avatarUrl: null })
    })

    it('has nothing to show for an account that never gave a name or a photo', () => {
        expect(readProfile({ app_metadata: {}, user_metadata: {} })).toEqual({ name: null, avatarUrl: null })
    })
})

describe('displayNameOf', () => {
    it('falls back on the front of the address, never on a placeholder one', () => {
        expect(displayNameOf({ app_metadata: {}, user_metadata: {}, email: 'ada@moldwright.robagentic.tech' })).toBe('ada')
        expect(displayNameOf({ app_metadata: {}, user_metadata: {}, email: '33612345678@phone.rerun.build' })).toBeNull()
    })

    it('never shows the random front of an Apple relay address as a name', () => {
        expect(displayNameOf({ app_metadata: { provider: 'apple' }, user_metadata: {}, email: 'x7k2abc9@privaterelay.appleid.com' })).toBeNull()
        expect(displayNameOf({ app_metadata: { full_name: 'Ada Lovelace' }, user_metadata: {}, email: 'x7k2abc9@privaterelay.appleid.com' })).toBe('Ada Lovelace')
    })
})
