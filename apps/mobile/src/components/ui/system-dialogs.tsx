import { ActionSheetIOS, Alert } from 'react-native'

import type { ActionSheetRequest, TextPromptRequest } from '@/components/ui/dialog-types'

export type { ActionSheetRequest, TextPromptRequest } from '@/components/ui/dialog-types'

export function showActionSheet(request: ActionSheetRequest, onSelect: (index: number) => void): void {
    ActionSheetIOS.showActionSheetWithOptions(request, onSelect)
}

export function promptText({ title, message, defaultValue, cancelLabel, submitLabel, preferred, onSubmit, onCancel }: TextPromptRequest): void {
    if (!cancelLabel || !submitLabel) {
        Alert.prompt(title, message, text => onSubmit(text), 'plain-text', defaultValue)
        return
    }
    Alert.prompt(
        title,
        message,
        [
            { text: cancelLabel, style: 'cancel', onPress: onCancel },
            { text: submitLabel, isPreferred: preferred, onPress: (text?: string) => onSubmit(text ?? '') },
        ],
        'plain-text',
        defaultValue
    )
}

// iOS draws both as system alerts: nothing to mount.
export function SystemDialogHost() {
    return null
}
