import { MAX_UPLOAD_FILE_BYTES } from '@rerun/contracts'
import * as DocumentPicker from 'expo-document-picker'
import * as ImagePicker from 'expo-image-picker'
import { Alert } from 'react-native'
import { useTranslations } from 'use-intl'

import { fitAttachments, imageAttachment, MAX_ATTACHMENTS, type ComposerAttachment } from './attachments'

/**
 * Picking files off the phone, with what did not fit said out loud. Shared by the composer and the
 * answer to a coworker's question, which attach the same way to the same folder.
 */
export function useAttachmentPicker(attachments: ComposerAttachment[], onChange: (next: ComposerAttachment[]) => void) {
    const t = useTranslations('mobileChat.composer')

    const add = (added: ComposerAttachment[]) => {
        const { attachments: next, tooBig, noRoom } = fitAttachments(attachments, added)
        if (tooBig.length > 0) Alert.alert(t('tooLargeTitle', { count: tooBig.length }), t('tooLargeBody', { files: tooBig.map(file => file.name).join(', '), megabytes: MAX_UPLOAD_FILE_BYTES / 1024 / 1024 }))
        if (noRoom.length > 0) Alert.alert(t('tooManyTitle'), t('tooManyBody', { max: MAX_ATTACHMENTS, files: noRoom.map(file => file.name).join(', ') }))
        onChange(next)
    }

    const pickPhotos = async () => {
        const room = MAX_ATTACHMENTS - attachments.length
        if (room <= 0) return
        // Compatible hands over a JPEG instead of the library's HEIC, which the models do not all read.
        const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: room, quality: 0.8, preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible })
        if (!result.canceled) add(result.assets.map((asset, index) => ({ ...imageAttachment(asset.uri, attachments.length + index), size: asset.fileSize })))
    }

    const takePhoto = async () => {
        if (attachments.length >= MAX_ATTACHMENTS) return
        const { granted } = await ImagePicker.requestCameraPermissionsAsync()
        if (!granted) return
        const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 }).catch(() => null)
        if (result && !result.canceled) add([imageAttachment(result.assets[0].uri, attachments.length)])
    }

    const pickFiles = async () => {
        if (attachments.length >= MAX_ATTACHMENTS) return
        const result = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true }).catch(() => null)
        if (result && !result.canceled) add(result.assets.map(asset => ({ uri: asset.uri, name: asset.name, mimeType: asset.mimeType ?? 'application/octet-stream', size: asset.size })))
    }

    return { add, pickPhotos, takePhoto, pickFiles }
}
