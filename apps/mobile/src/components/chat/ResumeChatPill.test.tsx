import type { ResumeChat } from '@rerun/contracts'
import { fireEvent, render, screen } from '@testing-library/react-native'

import { ResumeChatPill } from './ResumeChatPill'

jest.mock('react-native-svg', () => {
    const Shape = () => null
    return { __esModule: true, default: Shape, Svg: Shape, Path: Shape, G: Shape, Circle: Shape, Rect: Shape, Defs: Shape, LinearGradient: Shape, RadialGradient: Shape, Stop: Shape, Polygon: Shape, Ellipse: Shape, Line: Shape, ClipPath: Shape, Mask: Shape }
})

const resume: ResumeChat = { sessionId: 'digest', title: 'Weekly funnel digest', deviceKind: 'computer', changedAt: '2026-11-24T09:00:00.000Z' }

describe('the conversation offered from another device', () => {
    it('opens on a tap, and goes away on its cross', async () => {
        const onContinue = jest.fn()
        const onDismiss = jest.fn()
        await render(<ResumeChatPill resume={resume} onContinue={onContinue} onDismiss={onDismiss} />)
        await fireEvent.press(screen.getByRole('button', { name: 'Continue Weekly funnel digest' }))
        expect(onContinue).toHaveBeenCalledWith('digest')
        await fireEvent.press(screen.getByLabelText('Dismiss'))
        expect(onDismiss).toHaveBeenCalledTimes(1)
    })

    it('names a conversation that has no title yet', async () => {
        await render(<ResumeChatPill resume={{ ...resume, title: null }} onContinue={() => {}} onDismiss={() => {}} />)
        expect(screen.getByRole('button', { name: 'Continue New conversation' })).toBeTruthy()
    })
})
