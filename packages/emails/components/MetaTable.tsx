import * as React from "react";
import { readingSides } from "./direction";
import { theme } from "../theme";

export interface MetaTableProps {
  rows: { label: string; value: React.ReactNode }[];
  locale?: string;
}

/**
 * Label/value rows. A two-column table rather than `justify-content: space-between`, which
 * the Word engine behind Outlook and Gmail's sanitiser both ignore.
 */
export function MetaTable({ rows, locale }: MetaTableProps) {
  return (
    <SplitTable>
      {rows.map((row) => (
        <SplitRow
          key={row.label}
          left={<span style={label}>{row.label}</span>}
          right={<span style={value}>{row.value}</span>}
          locale={locale}
        />
      ))}
    </SplitTable>
  );
}

export function SplitTable({ children }: { children: React.ReactNode }) {
  return (
    <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} border={0} style={table}>
      <tbody>{children}</tbody>
    </table>
  );
}

export function SplitRow({
  left,
  right,
  locale,
}: {
  left: React.ReactNode;
  right: React.ReactNode;
  locale?: string;
}) {
  const sides = readingSides(locale);
  return (
    <tr>
      <td align={sides.start} style={{ ...leftCell, padding: sides.start === "left" ? "3px 8px 3px 0" : "3px 0 3px 8px", textAlign: sides.start }}>
        {left}
      </td>
      <td align={sides.end} style={{ ...rightCell, textAlign: sides.end }}>
        {right}
      </td>
    </tr>
  );
}

const table: React.CSSProperties = {
  borderCollapse: "collapse",
};

const leftCell: React.CSSProperties = {
  verticalAlign: "top",
};

const rightCell: React.CSSProperties = {
  padding: "3px 0",
  verticalAlign: "top",
};

const label: React.CSSProperties = {
  color: theme.text.faint,
  fontFamily: theme.font.mono,
  fontSize: "11px",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
};

const value: React.CSSProperties = {
  color: theme.text.body,
  fontFamily: theme.font.mono,
  fontSize: "12px",
  fontVariantNumeric: "tabular-nums",
};
