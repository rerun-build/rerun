'use client'

import { SkeletonRows } from '@/components/ui/skeleton'
import dynamic from 'next/dynamic'

import type { FileCodeMirrorProps } from './FileCodeMirror'

const FileCodeMirror = dynamic(() => import('./FileCodeMirror'), {
    ssr: false,
    loading: () => <SkeletonRows rows={8} className="p-3" />,
})

export function FileTextEditor(props: FileCodeMirrorProps) {
    return (
        <div className="h-full min-h-0 overflow-auto">
            <FileCodeMirror {...props} />
        </div>
    )
}
