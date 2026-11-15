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
    cancelLabel?: string
    submitLabel?: string
    preferred?: boolean
    onSubmit: (text: string) => void
    onCancel?: () => void
}
