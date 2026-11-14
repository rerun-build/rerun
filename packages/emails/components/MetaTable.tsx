import * as React from "react";
import { theme } from "../theme";

export interface MetaTableProps {
  rows: { label: string; value: React.ReactNode }[];
}

export function MetaTable({ rows }: MetaTableProps) {
  return (
    <SplitTable>
      {rows.map((row) => (
        <SplitRow
          key={row.label}
          left={<span style={label}>{row.label}</span>}
          right={<span style={value}>{row.value}</span>}
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
}: {
  left: React.ReactNode;
  right: React.ReactNode;
}) {
  return (
    <tr>
      <td align="left" style={leftCell}>
        {left}
      </td>
      <td align="right" style={rightCell}>
        {right}
      </td>
    </tr>
  );
}

const table: React.CSSProperties = {
  borderCollapse: "collapse",
};

const leftCell: React.CSSProperties = {
  padding: "3px 8px 3px 0",
  textAlign: "left",
  verticalAlign: "top",
};

const rightCell: React.CSSProperties = {
  padding: "3px 0",
  textAlign: "right",
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
