import { render, screen } from '@testing-library/react-native'
import { StyleSheet } from 'react-native'

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
        expect(screen.queryByTestId('edge-fade-solid')).toBeNull()
    })

    it('stays opaque over its solid part, as a plain view the glass above sees, then fades out', async () => {
        await render(<EdgeFade edge="bottom" height={100} solid={75} />)
        const solid = StyleSheet.flatten(screen.getByTestId('edge-fade-solid').props.style)
        expect(solid).toMatchObject({ bottom: 0, height: 75 })
        expect(stops()).toEqual(['stop:0:1', 'stop:1:0'])
    })
})
