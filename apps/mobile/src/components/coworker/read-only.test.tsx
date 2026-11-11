import { fireEvent, render, screen } from '@testing-library/react-native'

import { BOX_MANAGE_REASON, type ManageLock } from '@/auth/access'
import { MOCK_APPS_TO_CONNECT, MOCK_ROUTINES } from '@/mocks/coworkerDetails'
import { isSwitchDisabled } from '@/test/switch'

import { CoworkerApps } from './CoworkerApps'
import { CoworkerRoutines } from './CoworkerRoutines'

jest.mock('expo-router', () => ({ router: { back: jest.fn(), push: jest.fn(), replace: jest.fn(), canGoBack: () => true } }))
jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default)
jest.mock('react-native-svg', () => ({ __esModule: true, default: () => null, Path: () => null }))

const USE_ONLY: ManageLock = { locked: true, reason: BOX_MANAGE_REASON }
const UNKNOWN: ManageLock = { locked: true, reason: null }
const BOX_MANAGE_TEXT = 'Only an admin or a manager of this Box can change this.'

describe('a coworker the caller only uses', () => {
    it('lists its routines with every switch greyed and says why', async () => {
        const onToggle = jest.fn()
        await render(<CoworkerRoutines name="Scout" routines={MOCK_ROUTINES} savingKeys={[]} lock={USE_ONLY} onToggle={onToggle} onBack={() => {}} />)
        expect(screen.getByText(BOX_MANAGE_TEXT)).toBeTruthy()
        for (const routine of MOCK_ROUTINES) expect(isSwitchDisabled(screen.getByLabelText(routine.name))).toBe(true)
    })

    it('keeps the routine switches open to a manager', async () => {
        await render(<CoworkerRoutines name="Scout" routines={MOCK_ROUTINES} savingKeys={[]} onToggle={() => {}} onBack={() => {}} />)
        expect(screen.queryByText(BOX_MANAGE_TEXT)).toBeNull()
        expect(isSwitchDisabled(screen.getByLabelText(MOCK_ROUTINES[0].name))).toBe(false)
    })

    it('shows the apps to connect with a greyed Connect that does nothing', async () => {
        const onConnect = jest.fn()
        await render(<CoworkerApps name="Scout" apps={MOCK_APPS_TO_CONNECT} connectingKey={null} lock={USE_ONLY} onConnect={onConnect} onBack={() => {}} />)
        expect(screen.getByText(BOX_MANAGE_TEXT)).toBeTruthy()
        const [connect] = screen.getAllByRole('button', { name: 'Connect' })
        expect(connect.props.accessibilityState).toMatchObject({ disabled: true })
        await fireEvent.press(connect)
        expect(onConnect).not.toHaveBeenCalled()
    })
})

describe('a coworker whose level is not known yet', () => {
    it('keeps the routine switches greyed without saying why', async () => {
        const onToggle = jest.fn()
        await render(<CoworkerRoutines name="Scout" routines={MOCK_ROUTINES} savingKeys={[]} lock={UNKNOWN} onToggle={onToggle} onBack={() => {}} />)
        expect(screen.queryByText(BOX_MANAGE_TEXT)).toBeNull()
        expect(screen.getByText('Ask Scout in the chat to set one up.')).toBeTruthy()
        for (const routine of MOCK_ROUTINES) expect(isSwitchDisabled(screen.getByLabelText(routine.name))).toBe(true)
    })

    it('keeps Connect greyed without saying why', async () => {
        const onConnect = jest.fn()
        await render(<CoworkerApps name="Scout" apps={MOCK_APPS_TO_CONNECT} connectingKey={null} lock={UNKNOWN} onConnect={onConnect} onBack={() => {}} />)
        expect(screen.queryByText(BOX_MANAGE_TEXT)).toBeNull()
        const [connect] = screen.getAllByRole('button', { name: 'Connect' })
        expect(connect.props.accessibilityState).toMatchObject({ disabled: true })
        await fireEvent.press(connect)
        expect(onConnect).not.toHaveBeenCalled()
    })
})
