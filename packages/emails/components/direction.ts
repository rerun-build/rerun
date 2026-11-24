import { localeDirection } from "@rerun/i18n";

// Outlook reads neither `dir` nor `text-align: start`: every aligned cell spells out its side, and in
// Arabic or Hebrew that side is mirrored.
export function readingSides(locale: string = "en"): { start: "left" | "right"; end: "left" | "right" } {
  return localeDirection(locale) === "rtl" ? { start: "right", end: "left" } : { start: "left", end: "right" };
}
