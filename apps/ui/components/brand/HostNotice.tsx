import { BrandLogo } from '@/components/brand/BrandLogo'
import type { ReactNode } from 'react'

// A whole page for one sentence, under the brand of the host.
export function HostNotice({ title, message, children }: { title: string; message: string; children?: ReactNode }) {
    return (
        <main className="flex min-h-dvh w-full flex-col items-center justify-center bg-background px-5 py-10 text-foreground">
            <div className="flex w-full max-w-sm flex-col items-center gap-6 text-center">
                <BrandLogo size="lg" aria-hidden />
                <div className="flex flex-col gap-1.5">
                    <h1 className="text-xl font-semibold tracking-tight text-balance break-words">{title}</h1>
                    <p className="text-sm text-balance break-words text-muted-foreground">{message}</p>
                </div>
                {children && <div className="flex w-full flex-col gap-2.5">{children}</div>}
            </div>
        </main>
    )
}
