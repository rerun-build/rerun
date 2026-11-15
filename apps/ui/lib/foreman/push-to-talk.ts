type KeyLike = Pick<KeyboardEvent, 'code' | 'repeat' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'isComposing'>

export type PushToTalkScene = {
    focusHeld: boolean
    overlayOpen: boolean
}

export function shouldPushToTalk(event: KeyLike, scene: PushToTalkScene): boolean {
    if (event.code !== 'Space' || event.repeat || event.isComposing) return false
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return false
    return !scene.focusHeld && !scene.overlayOpen
}
