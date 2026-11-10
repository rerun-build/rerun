"use client"

import * as React from "react"
import { useTranslations } from "next-intl"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut } from "@rerun/ui/forms"

import { cn } from "@/lib/utils"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

function CommandDialog({
  title,
  description,
  children,
  className,
  showCloseButton = false,
  ...props
}: React.ComponentProps<typeof Dialog> & {
  title?: string
  description?: string
  className?: string
  showCloseButton?: boolean
}) {
  const t = useTranslations("ui")
  return (
    // asSheet={false}: a bottom sheet would sit under the virtual keyboard the search field opens.
    <Dialog {...props} asSheet={false}>
      <DialogHeader className="sr-only">
        <DialogTitle>{title ?? t("command.title")}</DialogTitle>
        <DialogDescription>{description ?? t("command.description")}</DialogDescription>
      </DialogHeader>
      <DialogContent
        className={cn(
          "top-1/3 translate-y-0 overflow-hidden rounded-xl! p-0",
          className
        )}
        showCloseButton={showCloseButton}
      >
        {children}
      </DialogContent>
    </Dialog>
  )
}

export {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
}
