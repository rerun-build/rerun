"use client"

import * as React from "react"
import { useTranslations } from "next-intl"
import { Dialog as DialogPrimitive } from "radix-ui"
import { Drawer as DrawerPrimitive } from "vaul"
import { useResolvedIsMobile } from "@rerun/ui/primitives/use-is-mobile"

import { cn } from "@/lib/utils"
import { useCoverBoard } from "@/stores/board-cover.store"
import { Button } from "@/components/ui/button"
import { XIcon } from '@/lib/icons'

// Under sm every dialog renders as a vaul bottom sheet instead of a centered Radix modal, so the
// callers keep one import and one markup for both. The context is what lets each part pick its
// primitive without the caller passing anything down.
const SheetModeContext = React.createContext({ isSheet: false, dismissible: true, close: () => {} })

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

  // Rotating a phone crosses the 640px breakpoint, and swapping primitives under an open dialog
  // would remount it and wipe the form. So the mode only follows the media query while closed —
  // plus the very first client read, which a dialog mounted already open would otherwise miss.
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

  const close = React.useCallback(() => handleOpenChange(false), [handleOpenChange])
  const mode = React.useMemo(() => ({ isSheet, dismissible, close }), [isSheet, dismissible, close])

  return (
    <SheetModeContext.Provider value={mode}>
      {isSheet ? (
        // repositionInputs off: vaul's keyboard handler writes `height` and `bottom` inline on the
        // sheet, from the height it measured at the first focus, and never takes them back. A sheet
        // that changes step after a field was typed in stays the size of that first step on iOS,
        // and its lift stacks on top of Safari's own pan toward the focused field. Safari's pan alone
        // keeps the field in view and leaves the layout to CSS.
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
  const { isSheet, dismissible, close } = useSheetMode()

  if (isSheet) {
    return (
      <DialogPortal>
        <DialogOverlay />
        <DrawerPrimitive.Content
          data-slot="dialog-content"
          className={cn(
            // overflow-auto and not overflow-y-auto: it has to sit in the same tailwind-merge group
            // as the `overflow-hidden` the panelled dialogs pass, so theirs wins cleanly.
            // mx-auto keeps the sheet centered if a caller max-w applies, which happens while the
            // window is resized past sm with the dialog open and the mode still latched.
            // Note that a caller passing `p-0` drops the safe-area padding below along with the
            // rest of `p-4` — those dialogs have to carry it on their own bottom-most row.
            // The bottom is not always the bottom: the mobile cookie bar owns that strip while it
            // is up, so the sheet sits on the inset it publishes instead of under it.
            // touch-pan-y!: vaul injects `touch-action: none` on the drawer, and the drawer is the
            // scroller here, so without it a finger cannot scroll a sheet taller than the screen.
            // The `!` is required, vaul's rule is unlayered and beats a plain utility.
            // after:hidden!: vaul hangs a 200% tall filler under the drawer, which a scrolling drawer
            // counts as content, so the sheet would scroll two screens into the void.
            "fixed inset-x-0 bottom-[var(--consent-inset)] z-50 mx-auto flex max-h-[calc(96dvh_-_var(--consent-inset))] touch-pan-y! flex-col after:hidden! gap-4 overflow-auto overscroll-contain rounded-t-2xl bg-popover p-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-sm text-popover-foreground ring-1 ring-foreground/10 outline-none",
            className
          )}
          {...props}
        >
          {/* A sheet you can swipe away needs no close button; one you cannot still does. */}
          {dismissible ? <SheetGrabber /> : null}
          {children}
          {/* A plain button and not DrawerPrimitive.Close: vaul drops every close request of a
              drawer that is not dismissible, so its Close would do nothing here. */}
          {showCloseButton && !dismissible && (
            <Button data-slot="dialog-close" variant="ghost" className="absolute top-2 right-2" size="icon-sm" onClick={close}>
              <XIcon />
              <span className="sr-only">{t("close")}</span>
            </Button>
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
