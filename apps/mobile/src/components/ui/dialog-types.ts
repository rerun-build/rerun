export type ActionSheetRequest = {
    title?: string
    message?: string
    options: string[]
    cancelButtonIndex: number
    destructiveButtonIndex?: number
}

export type TextPromptRequest = {
    title: string
    message?: string
    defaultValue?: string
    // Without labels, iOS draws its own Cancel and OK.
    cancelLabel?: string
    submitLabel?: string
    preferred?: boolean
    onSubmit: (text: string) => void
    onCancel?: () => void
}
