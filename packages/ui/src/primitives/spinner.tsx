"use client"

import { cn } from "../cn"
import { useKitTranslations } from "../locale"

/**
 * L'icône loader du pack Nucleo peint ses arcs avec un gradient `#000` codé en dur :
 * invisible sur fond sombre. On la remplace par la même silhouette (viewBox 18,
 * rayon 7.25, stroke 1.5) en `currentColor`.
 */
function SpinnerIcon({ size = 18, strokeWidth = 1.5, className, ...props }: React.ComponentProps<"svg"> & { size?: number | string }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18" width={size} height={size} fill="none" className={className} {...props}>
            <circle cx="9" cy="9" r="7.25" stroke="currentColor" strokeWidth={strokeWidth} opacity="0.25" />
            <path d="M9 1.75a7.25 7.25 0 1 1-7.25 7.25" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" />
        </svg>
    )
}

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  const t = useKitTranslations()
  return (
    <SpinnerIcon role="status" aria-label={t('primitives.loading')} className={cn("size-4 animate-spin", className)} {...props} />
  )
}

export { Spinner, SpinnerIcon }
