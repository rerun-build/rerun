import * as React from "react";
import { Button as REButton } from "@react-email/components";
import { theme } from "../theme";

export interface ButtonProps {
  href: string;
  children: React.ReactNode;
}

export function Button({ href, children }: ButtonProps) {
  return (
    <REButton href={href} style={button}>
      {children}
    </REButton>
  );
}

const button: React.CSSProperties = {
  backgroundColor: theme.text.strong,
  borderRadius: "10px",
  boxShadow: "0 1px 0 #ffffff, 0 2px 6px rgba(0, 0, 0, 0.55)",
  color: theme.surface.page,
  display: "inline-block",
  fontSize: "14px",
  fontWeight: 500,
  letterSpacing: "-0.01em",
  padding: "12px 22px",
  textDecoration: "none",
};
