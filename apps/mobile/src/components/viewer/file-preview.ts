export type FilePreview = 'page' | 'text' | 'none'

export function filePreviewOf(_name: string): FilePreview {
    return 'page'
}
