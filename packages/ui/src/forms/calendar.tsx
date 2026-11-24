"use client";

import { DayPicker, type DayPickerProps } from "react-day-picker";

import { cn } from "../cn";
import { ChevronLeft, ChevronRight } from "../icons";
import { buttonVariants } from "../primitives/button-variants";

const NAV_BUTTON = cn(
  buttonVariants({ variant: "ghost", size: "icon-sm" }),
  "aria-disabled:pointer-events-none aria-disabled:opacity-40",
);
const RANGE_EDGE =
  "bg-primary/15 [&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:hover:bg-primary";

function Calendar({
  className,
  classNames,
  components,
  showOutsideDays = false,
  ...props
}: DayPickerProps) {
  return (
    <DayPicker
      data-slot="calendar"
      showOutsideDays={showOutsideDays}
      className={cn("w-fit", className)}
      classNames={{
        months: "relative flex flex-col gap-4 sm:flex-row",
        month: "flex flex-col gap-3",
        nav: "absolute inset-x-0 top-0 flex items-center justify-between",
        button_previous: NAV_BUTTON,
        button_next: NAV_BUTTON,
        month_caption: "flex h-7 items-center justify-center",
        caption_label: "text-sm font-medium first-letter:uppercase",
        month_grid: "border-collapse",
        weekdays: "flex",
        weekday: "w-8 text-[11px] font-normal text-muted-foreground",
        week: "mt-1 flex",
        day: "size-8 p-0 text-center text-sm",
        day_button:
          "size-8 rounded-md tabular-nums outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50",
        today: "[&>button]:ring-1 [&>button]:ring-foreground/25",
        selected:
          "[&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:hover:bg-primary",
        range_start: cn(RANGE_EDGE, "rounded-s-md"),
        range_end: cn(RANGE_EDGE, "rounded-e-md"),
        range_middle:
          "bg-primary/15 [&>button]:bg-transparent! [&>button]:text-foreground! [&>button]:hover:bg-primary/20!",
        outside: "text-muted-foreground/50",
        disabled: "text-muted-foreground/40 [&>button]:pointer-events-none",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, className: chevronClassName }) =>
          orientation === "left" ? (
            <ChevronLeft className={cn("size-4", chevronClassName)} />
          ) : (
            <ChevronRight className={cn("size-4", chevronClassName)} />
          ),
        ...components,
      }}
      {...props}
    />
  );
}

export { Calendar };
export type { DateRange } from "react-day-picker";
export { fr as calendarLocaleFr } from "react-day-picker/locale/fr";
