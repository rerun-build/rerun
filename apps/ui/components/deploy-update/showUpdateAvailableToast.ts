import { toast } from 'sonner'

const UPDATE_TOAST_ID = 'deploy-update'

export type UpdateToastCopy = { title: string; description: string; reload: string }

export function showUpdateAvailableToast(copy: UpdateToastCopy) {
    toast(copy.title, {
        id: UPDATE_TOAST_ID,
        description: copy.description,
        duration: Infinity,
        action: { label: copy.reload, onClick: () => window.location.reload() },
    })
}

export function dismissUpdateAvailableToast() {
    toast.dismiss(UPDATE_TOAST_ID)
}
