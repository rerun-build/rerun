import { fireEvent, render, screen } from '@testing-library/react-native'

import { AI_PROVIDERS_ADMIN_ONLY } from '@/auth/access'
import { AI_CONNECTIONS_FULL, AI_CONNECTIONS_RERUN_ONLY } from '@/mocks/aiConnections'
import { isSwitchDisabled } from '@/test/switch'

import { ConnectionDetail } from './ConnectionDetail'
import { ProvidersList } from './ProvidersList'

jest.mock('expo-router', () => ({ router: { back: jest.fn(), push: jest.fn(), replace: jest.fn(), canGoBack: () => true } }))
jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default)
jest.mock('react-native-svg', () => ({ __esModule: true, default: () => null, Path: () => null }))

const ADMIN_ONLY_TEXT = 'Only an admin can change the AI providers.'

const listHandlers = () => ({ onClose: jest.fn(), onOpen: jest.fn(), onAdd: jest.fn(), onAddKind: jest.fn(), onChangeDefault: jest.fn() })

describe('AI providers for a member', () => {
    it('opens every source to read and greys the default and every add', async () => {
        const handlers = listHandlers()
        await render(<ProvidersList view={AI_CONNECTIONS_FULL} readOnlyReason={AI_PROVIDERS_ADMIN_ONLY} {...handlers} />)
        expect(screen.getByText(ADMIN_ONLY_TEXT)).toBeTruthy()
        await fireEvent.press(screen.getByTestId('provider-default'))
        expect(handlers.onChangeDefault).not.toHaveBeenCalled()
        await fireEvent.press(screen.getByTestId('add-row-key'))
        expect(handlers.onAddKind).not.toHaveBeenCalled()
        await fireEvent.press(screen.getByTestId('provider-cnx-openrouter'))
        expect(handlers.onOpen).toHaveBeenCalledWith('cnx-openrouter')
    })

    it('greys the providers an empty group offers to add', async () => {
        const handlers = listHandlers()
        await render(<ProvidersList view={AI_CONNECTIONS_RERUN_ONLY} readOnlyReason={AI_PROVIDERS_ADMIN_ONLY} {...handlers} />)
        await fireEvent.press(screen.getByTestId('add-claude'))
        expect(handlers.onAdd).not.toHaveBeenCalled()
    })

    it('keeps everything open to an admin', async () => {
        const handlers = listHandlers()
        await render(<ProvidersList view={AI_CONNECTIONS_FULL} {...handlers} />)
        expect(screen.queryByText(ADMIN_ONLY_TEXT)).toBeNull()
        await fireEvent.press(screen.getByTestId('add-row-key'))
        expect(handlers.onAddKind).toHaveBeenCalledWith('key')
    })

    it('shows a connection without letting it be renamed, switched or removed', async () => {
        const connection = AI_CONNECTIONS_FULL.connections.find(candidate => candidate.id === 'cnx-openrouter')!
        const onRemove = jest.fn()
        const onRename = jest.fn()
        await render(<ConnectionDetail connection={connection} view={AI_CONNECTIONS_FULL} error={null} onBack={() => {}} onRename={onRename} onModels={() => {}} onBaseUrl={() => {}} onExtraModels={() => {}} onSignInAgain={() => {}} replacement={{ key: '', onKey: () => {}, busy: false, error: null, onSave: () => {} }} onRemove={onRemove} readOnlyReason={AI_PROVIDERS_ADMIN_ONLY} />)
        expect(screen.getByText(ADMIN_ONLY_TEXT)).toBeTruthy()
        await fireEvent.press(screen.getByText(`Remove ${connection.name}`))
        expect(onRemove).not.toHaveBeenCalled()
        await fireEvent.press(screen.getByLabelText('Name'))
        expect(onRename).not.toHaveBeenCalled()
        for (const model of connection.models) {
            const toggle = screen.queryByTestId(`model-${model.id}`)
            if (toggle) expect(isSwitchDisabled(toggle)).toBe(true)
        }
    })
})
