import * as React from "react";
import { Img } from "@react-email/components";
import { readingSides } from "./direction";
import type { EmailLocale } from "../i18n";
import { theme } from "../theme";

const PORTRAIT = 44;
const GAP = 8;

export interface BubbleProps {
  children: string;
  /** The coworker's portrait, turned towards the bubble. Without it the bubble stands alone. */
  portraitUrl?: string;
  locale?: EmailLocale;
}

/** What a coworker says, in its own bubble: a table, since the Word engine lays nothing else side by side. */
export function Bubble({ children, portraitUrl, locale }: BubbleProps) {
  const leftToRight = readingSides(locale).start === "left";
  return (
    <table role="presentation" cellPadding={0} cellSpacing={0} border={0} width="100%" style={table}>
      <tbody>
        <tr>
          {portraitUrl ? (
            <td width={PORTRAIT + GAP} style={{ ...cell, padding: leftToRight ? `0 ${GAP}px 0 0` : `0 0 0 ${GAP}px`, width: `${PORTRAIT}px` }}>
              <Img src={portraitUrl} width={PORTRAIT} height={PORTRAIT} alt="" style={{ display: "block" }} />
            </td>
          ) : null}
          <td style={cell}>
            <div style={{ ...bubble, borderRadius: leftToRight ? "18px 18px 18px 4px" : "18px 18px 4px 18px" }}>
              <p dir="auto" style={message}>
                {children}
              </p>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  );
}

const table: React.CSSProperties = { borderCollapse: "collapse" };

const cell: React.CSSProperties = { verticalAlign: "bottom" };

const bubble: React.CSSProperties = {
  backgroundColor: theme.surface.border,
  display: "inline-block",
  padding: "11px 16px",
};

const message: React.CSSProperties = {
  color: theme.text.strong,
  fontSize: "15px",
  lineHeight: "23px",
  margin: 0,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
};
