"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { useIsMobile } from "@rerun/ui/primitives/use-is-mobile"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon, XIcon } from '@/lib/icons'

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme } = useTheme()
  const isMobile = useIsMobile()
  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      position={isMobile ? "top-center" : "bottom-left"}
      mobileOffset={{ top: "calc(env(safe-area-inset-top) + 12px)" }}
      gap={isMobile ? 8 : 14}
      className="toaster group"
      closeButton
      icons={{
        close: (
          <XIcon className="size-3.5" />
        ),
        success: (
          <CircleCheckIcon className="size-4" />
        ),
        info: (
          <InfoIcon className="size-4" />
        ),
        warning: (
          <TriangleAlertIcon className="size-4" />
        ),
        error: (
          <OctagonXIcon className="size-4" />
        ),
        loading: (
          <Loader2Icon className="size-4 animate-spin" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
