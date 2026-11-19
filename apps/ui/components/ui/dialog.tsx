"use client"

import * as React from "react"
import { useTranslations } from "next-intl"
import { Dialog as DialogPrimitive } from "radix-ui"
import { Drawer as DrawerPrimitive } from "vaul"
import { useResolvedIsMobile } from "@moldwright/ui/primitives/use-is-mobile"

import { cn } from "@/lib/utils"
import { useCoverBoard } from "@/stores/board-cover.store"
import { Button } from "@/components/ui/button"
import { XIcon } from '@/lib/icons'

const SheetModeContext = React.createContext({ isSheet: false, dismissible: true })

function useSheetMode() {
  return React.useContext(SheetModeContext)
}

function Dialog({
  open,
  defaultOpen,
  onOpenChange,
  asSheet = true,
  dismissible = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root> & {
  asSheet?: boolean
  dismissible?: boolean
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen ?? false)
  const isOpen = open ?? uncontrolledOpen
  const resolvedIsMobile = useResolvedIsMobile()

  const modeRef = React.useRef<boolean | null>(null)
  if (resolvedIsMobile !== null && (!isOpen || modeRef.current === null)) modeRef.current = resolvedIsMobile
  const isSheet = asSheet && (modeRef.current ?? false)

  const handleOpenChange = React.useCallback(
    (next: boolean) => {
      setUncontrolledOpen(next)
      onOpenChange?.(next)
    },
    [onOpenChange]
  )

  const mode = React.useMemo(() => ({ isSheet, dismissible }), [isSheet, dismissible])

  return (
    <SheetModeContext.Provider value={mode}>
      {isSheet ? (
        <DrawerPrimitive.Root
          open={isOpen}
          onOpenChange={handleOpenChange}
          dismissible={dismissible}
          repositionInputs={false}
          {...props}
        />
      ) : (
        <DialogPrimitive.Root
          data-slot="dialog"
          open={isOpen}
          onOpenChange={handleOpenChange}
          {...props}
        />
      )}
    </SheetModeContext.Provider>
  )
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  const { isSheet } = useSheetMode()
  const Trigger = isSheet ? DrawerPrimitive.Trigger : DialogPrimitive.Trigger
  return <Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  const { isSheet } = useSheetMode()
  const Portal = isSheet ? DrawerPrimitive.Portal : DialogPrimitive.Portal
  return <Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  const { isSheet } = useSheetMode()
  const Close = isSheet ? DrawerPrimitive.Close : DialogPrimitive.Close
  return <Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  const { isSheet } = useSheetMode()
  const Overlay = isSheet ? DrawerPrimitive.Overlay : DialogPrimitive.Overlay
  useCoverBoard()
  return (
    <Overlay
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-black/10 duration-200 supports-backdrop-filter:backdrop-blur-xs data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

function SheetGrabber() {
  return (
    <div className="flex shrink-0 touch-none justify-center py-2">
      <div aria-hidden className="h-1.5 w-10 rounded-full bg-foreground/20" />
    </div>
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
}) {
  const t = useTranslations("ui")
  const { isSheet, dismissible } = useSheetMode()

  if (isSheet) {
    return (
      <DialogPortal>
        <DialogOverlay />
        <DrawerPrimitive.Content
          data-slot="dialog-content"
          className={cn(
            "fixed inset-x-0 bottom-[var(--consent-inset)] z-50 mx-auto flex max-h-[calc(96dvh_-_var(--consent-inset))] touch-pan-y! flex-col after:hidden! gap-4 overflow-auto overscroll-contain rounded-t-2xl bg-popover p-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-sm text-popover-foreground ring-1 ring-foreground/10 outline-none",
            className
          )}
          {...props}
        >
          {dismissible ? <SheetGrabber /> : null}
          {children}
          {showCloseButton && !dismissible && (
            <DrawerPrimitive.Close data-slot="dialog-close" asChild>
              <Button variant="ghost" className="absolute top-2 right-2" size="icon-sm">
                <XIcon />
                <span className="sr-only">{t("close")}</span>
              </Button>
            </DrawerPrimitive.Close>
          )}
        </DrawerPrimitive.Content>
      </DialogPortal>
    )
  }

  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          "fixed top-1/2 left-1/2 z-50 grid max-h-[calc(100dvh-2rem)] w-full max-w-[calc(100%-2rem)] -translate-x-1/2 overflow-auto -translate-y-1/2 gap-4 rounded-xl bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10 duration-200 outline-none sm:max-w-sm data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close data-slot="dialog-close" asChild>
            <Button
              variant="ghost"
              className="absolute top-2 right-2"
              size="icon-sm"
            >
              <XIcon
              />
              <span className="sr-only">{t("close")}</span>
            </Button>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "-mx-4 -mb-4 flex flex-col-reverse gap-2 border-t bg-muted/50 p-4 sm:flex-row sm:justify-end sm:rounded-b-xl",
        "max-sm:pb-[max(1rem,env(safe-area-inset-bottom))]",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && <DialogCloseButton />}
    </div>
  )
}

function DialogCloseButton() {
  const t = useTranslations("ui")
  const { isSheet } = useSheetMode()
  const Close = isSheet ? DrawerPrimitive.Close : DialogPrimitive.Close
  return (
    <Close asChild>
      <Button variant="outline">{t("close")}</Button>
    </Close>
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  const { isSheet } = useSheetMode()
  const Title = isSheet ? DrawerPrimitive.Title : DialogPrimitive.Title
  return (
    <Title
      data-slot="dialog-title"
      className={cn(
        "font-heading text-base leading-none font-medium",
        className
      )}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  const { isSheet } = useSheetMode()
  const Description = isSheet ? DrawerPrimitive.Description : DialogPrimitive.Description
  return (
    <Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
