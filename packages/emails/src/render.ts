import * as React from "react";
import { render } from "@react-email/components";

export async function renderEmail(
  element: React.ReactElement,
): Promise<{ html: string; text: string }> {
  const [html, text] = await Promise.all([
    render(element),
    render(element, { plainText: true }),
  ]);
  return { html, text };
}
