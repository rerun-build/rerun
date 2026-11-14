import * as React from "react";
import { Section, Text } from "@react-email/components";
import { theme, TONES, type ToneName } from "../theme";

export interface PanelProps {
  children: React.ReactNode;
  tone?: ToneName;
  mono?: boolean;
  style?: React.CSSProperties;
}

export function Panel({ children, tone, mono = false, style }: PanelProps) {
  const t = tone ? TONES[tone] : null;
  return (
    <Section
      style={{
        ...frame,
        backgroundColor: t ? t.insetFill : theme.surface.inset,
        border: `1px solid ${t ? t.insetBorder : theme.surface.border}`,
        ...style,
      }}
    >
      <Text style={mono ? { ...body, ...monoBody, color: t ? t.text : theme.text.body } : body}>
        {children}
      </Text>
    </Section>
  );
}

const frame: React.CSSProperties = {
  borderRadius: theme.radius.inner,
  padding: "14px 16px",
};

const body: React.CSSProperties = {
  color: theme.text.body,
  fontSize: "14px",
  lineHeight: "22px",
  margin: 0,
  whiteSpace: "pre-wrap",
};

const monoBody: React.CSSProperties = {
  fontFamily: theme.font.mono,
  fontSize: "13px",
  lineHeight: "20px",
};
