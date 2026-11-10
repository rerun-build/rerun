import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'

import { readMcpServer } from '@/api/mcp'
import { runMcpConnect } from '@/lib/oauth-connect'

import { McpWidget } from './McpWidget'

jest.mock('@/components/ui/BorderBeam', () => ({ BorderBeam: () => null }))
jest.mock('expo-image', () => ({ Image: () => null }))
jest.mock('@/auth/AuthProvider', () => ({ useAuth: () => ({ session: { access_token: 't' }, me: { workspace: { id: 7 } } }) }))
jest.mock('@/api/mcp', () => ({ readMcpServer: jest.fn() }))
jest.mock('@/lib/oauth-connect', () => ({ runMcpConnect: jest.fn() }))

const props = () => ({ pending: { kind: 'mcp' as const, toolCallId: 'call-1', input: { name: 'linear', reason: 'To read your issues' }, output: undefined }, agentId: 'a1', coworkerName: 'Scout', webUrl: '', onAnswer: jest.fn(), onDismiss: jest.fn() })
const linear = (status: 'connected' | 'needs_auth') => ({ name: 'linear', displayName: 'Linear', host: 'mcp.linear.app', icon: null, status, canSignIn: true })

describe('McpWidget', () => {
    it('signs in through the browser, then tells the coworker its tools are there', async () => {
        jest.mocked(readMcpServer).mockResolvedValue(linear('needs_auth'))
        jest.mocked(runMcpConnect).mockResolvedValue({ status: 'connected' })
        const mcp = props()
        await render(<McpWidget {...mcp} />)
        expect(await screen.findByText('Sign in to Linear')).toBeTruthy()
        await fireEvent.press(screen.getByLabelText('Connect'))
        await waitFor(() => expect(mcp.onAnswer).toHaveBeenCalledWith('MCP sign-in result:\n- linear: connected\n\nIts tools are available now. Please continue.'))
        expect(runMcpConnect).toHaveBeenCalledWith({ accessToken: 't', workspaceId: 7 }, 'a1', 'linear')
    })

    it('stays open with the reason when the sign-in fails', async () => {
        jest.mocked(readMcpServer).mockResolvedValue(linear('needs_auth'))
        jest.mocked(runMcpConnect).mockResolvedValue({ status: 'error', message: 'access_denied' })
        const mcp = props()
        await render(<McpWidget {...mcp} />)
        await fireEvent.press(await screen.findByLabelText('Connect'))
        expect(await screen.findByText('access_denied')).toBeTruthy()
        expect(mcp.onAnswer).not.toHaveBeenCalled()
    })

    it('continues at once on a server already connected, and skips in the words the coworker reads', async () => {
        jest.mocked(readMcpServer).mockResolvedValue(linear('connected'))
        const mcp = props()
        await render(<McpWidget {...mcp} />)
        await fireEvent.press(await screen.findByLabelText('Continue'))
        expect(mcp.onAnswer).toHaveBeenCalledTimes(1)

        const skipped = props()
        await render(<McpWidget {...skipped} />)
        await fireEvent.press(screen.getAllByLabelText('Not now').at(-1)!)
        expect(skipped.onAnswer).toHaveBeenCalledWith('[User skipped signing in to the MCP server]')
    })
})
