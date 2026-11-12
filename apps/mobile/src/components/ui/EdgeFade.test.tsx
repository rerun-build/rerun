import { render, screen } from '@testing-library/react-native'

import { EdgeFade } from '@/components/ui/EdgeFade'

jest.mock('react-native-svg', () => {
    const { View } = jest.requireActual('react-native')
    const passThrough = ({ children }: { children?: React.ReactNode }) => <>{children}</>
    return {
        __esModule: true,
        default: passThrough,
        Defs: passThrough,
        LinearGradient: passThrough,
        Rect: () => null,
        Stop: ({ offset, stopOpacity }: { offset: number; stopOpacity: number }) => <View testID={`stop:${offset}:${stopOpacity}`} />,
    }
})

const stops = () => screen.getAllByTestId(/^stop:/).map(stop => stop.props.testID)

describe('EdgeFade', () => {
    it('eases out from the edge by default', async () => {
        await render(<EdgeFade edge="top" height={100} />)
        expect(stops()).toEqual(['stop:0:1', 'stop:0.55:0.85', 'stop:1:0'])
    })

    it('stays opaque over its solid part, then fades out', async () => {
        await render(<EdgeFade edge="top" height={100} solid={75} />)
        expect(stops()).toEqual(['stop:0:1', 'stop:0.75:1', 'stop:1:0'])
    })
})
