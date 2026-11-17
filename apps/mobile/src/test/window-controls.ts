import type { CornerAdaptedInsets, EdgeInsets } from 'react-native-safe-area-context'

// Measured on iOS 26.5. The horizontal corner-adapted insets always carry the screen's rounded corners, on both
// sides; an iPadOS window adds its controls on the left, and only then does the vertical one grow past the top.

// iPad Pro 13-inch, Rerun in a 375x537 window.
export const IPAD_WINDOWED_INSETS: EdgeInsets = { top: 10, left: 0, right: 0, bottom: 10 }
export const IPAD_WINDOWED_CORNER_INSETS: CornerAdaptedInsets = {
    horizontal: { top: 10, left: 66, right: 9.5, bottom: 10 },
    vertical: { top: 53, left: 0, right: 0, bottom: 10 },
}

// iPad Pro 13-inch, Rerun full screen.
export const IPAD_FULL_SCREEN_INSETS: EdgeInsets = { top: 32, left: 0, right: 0, bottom: 20 }
export const IPAD_FULL_SCREEN_CORNER_INSETS: CornerAdaptedInsets = {
    horizontal: { top: 32, left: 9.5, right: 9.5, bottom: 20 },
    vertical: IPAD_FULL_SCREEN_INSETS,
}

// iPhone 17 Pro, portrait.
export const IPHONE_INSETS: EdgeInsets = { top: 62, left: 0, right: 0, bottom: 34 }
export const IPHONE_CORNER_INSETS: CornerAdaptedInsets = {
    horizontal: { top: 62, left: 18, right: 18, bottom: 34 },
    vertical: IPHONE_INSETS,
}
