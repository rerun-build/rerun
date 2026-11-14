export type MessageStreamAnimation = {
    animation: 'fadeIn' | 'blurIn' | 'slideUp'
    duration: number
    easing: string
    sep: 'word' | 'char'
    stagger: number
}

export const MESSAGE_STREAM_ANIMATION: MessageStreamAnimation = {
    animation: 'blurIn',
    duration: 120,
    easing: 'ease-out',
    sep: 'word',
    stagger: 0,
}
