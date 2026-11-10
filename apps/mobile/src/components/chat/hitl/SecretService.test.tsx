import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'

import { saveAgentKeys } from '@/api/agent-keys'
import { installService, resolveServices } from '@/api/services'
import { runConnect } from '@/lib/oauth-connect'

import { SecretWidget } from './SecretWidget'
import { ServiceWidget } from './ServiceWidget'

jest.mock('@/components/ui/BorderBeam', () => ({ BorderBeam: () => null }))
jest.mock('expo-image', () => ({ Image: () => null }))
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn() }))
jest.mock('@/auth/AuthProvider', () => ({ useAuth: () => ({ session: { access_token: 't' }, me: { workspace: { id: 7 } } }) }))
jest.mock('@/api/agent-keys', () => ({ fetchAgentKeys: jest.fn().mockResolvedValue({ keys: ['OLD_KEY'] }), saveAgentKeys: jest.fn().mockResolvedValue({ keys: [] }) }))
jest.mock('@/api/services', () => ({ resolveServices: jest.fn(), installService: jest.fn() }))
jest.mock('@/lib/oauth-connect', () => ({ runConnect: jest.fn() }))

const props = (kind: 'secret' | 'service', input: Record<string, unknown>) => ({ pending: { kind, toolCallId: 'call-1', input, output: undefined }, agentId: 'a1', coworkerName: 'Scout', webUrl: '', onAnswer: jest.fn(), onDismiss: jest.fn() })

const service = (slug: string, patch: object = {}) => ({ slug, name: slug.toUpperCase(), category: 'x', summary: '', icon: null, verified: true, authMethods: [{ id: 'oauth', label: 'OAuth', kind: 'oauth', recommended: true, inputs: [], requiresSecrets: false }], installStatus: null, pendingAuth: null, notFound: false, ...patch })

describe('SecretWidget', () => {
    it('writes the filled keys onto the coworker and tells it which ones it got', async () => {
        const secret = props('secret', { secrets: [{ key: 'API_KEY', label: 'API key' }, { key: 'OLD_KEY', label: 'Old key' }] })
        await render(<SecretWidget {...secret} />)
        await fireEvent.changeText(screen.getByLabelText('API key'), '  sk-123 ')
        await fireEvent.press(screen.getByLabelText('Save'))
        await waitFor(() => expect(secret.onAnswer).toHaveBeenCalled())
        expect(saveAgentKeys).toHaveBeenCalledWith({ accessToken: 't', workspaceId: 7 }, 'a1', { API_KEY: 'sk-123' })
        expect(secret.onAnswer.mock.calls[0][0]).toContain('- API_KEY: provided (stored as a coworker variable)\n- OLD_KEY: skipped')
    })

    it('declines in the words the coworker reads', async () => {
        const secret = props('secret', { secrets: [{ key: 'API_KEY', label: 'API key' }] })
        await render(<SecretWidget {...secret} />)
        await fireEvent.press(screen.getByLabelText('Skip'))
        expect(secret.onAnswer).toHaveBeenCalledWith('[User declined to provide the credentials]')
    })
})

describe('ServiceWidget', () => {
    it('signs an app in through the browser, counts one already connected, and answers once all are settled', async () => {
        jest.mocked(resolveServices).mockResolvedValue([service('gmail', { installStatus: 'active' }), service('notion')] as never)
        jest.mocked(installService).mockResolvedValue({ status: 'needs_auth', slug: 'notion', name: 'NOTION', pendingAuth: 'oauth', connectUrl: '', message: '' })
        jest.mocked(runConnect).mockResolvedValue({ status: 'connected' })
        const services = props('service', { services: [{ slug: 'gmail' }, { slug: 'notion' }] })
        await render(<ServiceWidget {...services} />)
        await fireEvent.press(await screen.findByLabelText('Connect'))
        await waitFor(() => expect(services.onAnswer).toHaveBeenCalledWith('App setup result:\n- GMAIL: connected\n- NOTION: connected\n\nPlease continue.'))
        expect(runConnect).toHaveBeenCalledWith({ accessToken: 't', workspaceId: 7 }, 'a1', 'notion')
    })

    it('leaves an app skipped when the person passes on it', async () => {
        jest.mocked(resolveServices).mockResolvedValue([service('notion')] as never)
        const services = props('service', { services: [{ slug: 'notion' }] })
        await render(<ServiceWidget {...services} />)
        await fireEvent.press(await screen.findByLabelText('Not now'))
        await waitFor(() => expect(services.onAnswer).toHaveBeenCalledWith('App setup result:\n- NOTION: skipped\n\nPlease continue.'))
    })
})
