import { logoUrlOf, workspaceInitials } from '@/components/home/workspace-logos'
import { initialSymbol } from '@/components/ui/system-symbols'

jest.mock('expo-file-system', () => ({ Directory: class {}, File: class {}, Paths: {} }))

describe('workspaceInitials', () => {
    it('takes the first letters of the first two words, and the default label when there is no name', () => {
        expect(workspaceInitials({ name: 'acme growth team' })).toBe('AG')
        expect(workspaceInitials({ name: 'Zeta' })).toBe('Z')
        expect(workspaceInitials({ name: '  ' })).toBe('MW')
    })

    it('keeps an emoji whole', () => {
        expect(workspaceInitials({ name: '🚀 Launch' })).toBe('🚀L')
    })
})

describe('logoUrlOf', () => {
    it('keeps only a full web address', () => {
        expect(logoUrlOf('https://x.supabase.co/storage/v1/object/public/workspace-logos/1.png')).toBe('https://x.supabase.co/storage/v1/object/public/workspace-logos/1.png')
        expect(logoUrlOf('/pricing/scale.png')).toBeNull()
        expect(logoUrlOf('')).toBeNull()
        expect(logoUrlOf(null)).toBeNull()
    })
})

describe('initialSymbol', () => {
    it('picks the lettered symbol of the first initial, and a building when it is not a letter', () => {
        expect(initialSymbol(workspaceInitials({ name: 'Acme' }))).toBe('a.circle.fill')
        expect(initialSymbol(workspaceInitials({ name: '🚀 Launch' }))).toBe('building.2')
    })
})
