import * as React from "react";
import { Img, Link } from "@react-email/components";
import { isWhiteLabel, type Brand } from "@rerun/contracts";
import { LOGO_SIZE, LOGO_URL } from "../assets";
import { theme } from "../theme";

type Side = "left" | "right";

export function Lockup({ brand, start }: { brand: Brand; start: Side }) {
  return isWhiteLabel(brand) ? <OrganizationLockup brand={brand} start={start} /> : <RerunLockup start={start} />;
}

function RerunLockup({ start }: { start: Side }) {
  return (
    <table align={start} role="presentation" style={lockup}>
      <tbody>
        <tr>
          <td style={logoCellOn(start)}>
            <Link href={SITE_URL} style={logoLink}>
              <Img
                src={LOGO_URL}
                width={LOGO_SIZE}
                height={LOGO_SIZE}
                alt="Rerun"
                style={logo}
              />
            </Link>
          </td>
          <td style={brandCell}>
            <Link href={SITE_URL} style={wordmark}>
              Rerun
            </Link>
          </td>
        </tr>
      </tbody>
    </table>
  );
}

function OrganizationLockup({ brand, start }: { brand: Brand; start: Side }) {
  return (
    <table align={start} role="presentation" style={lockup}>
      <tbody>
        <tr>
          {brand.iconUrl ? (
            <td style={logoCellOn(start)}>
              <Img
                src={brand.iconUrl}
                width={LOGO_SIZE}
                height={LOGO_SIZE}
                alt=""
                style={organizationIcon}
              />
            </td>
          ) : null}
          <td style={brandCell}>
            <span style={wordmark}>{brand.name}</span>
          </td>
        </tr>
      </tbody>
    </table>
  );
}

// The lockup points at the site, not at the app: the CTAs already carry `appUrl`.
const SITE_URL = "https://rerun.build";

const lockup: React.CSSProperties = {
  borderCollapse: "collapse",
};

const logoCellOn = (start: Side): React.CSSProperties => ({
  padding: start === "left" ? "0 10px 0 0" : "0 0 0 10px",
  verticalAlign: "middle",
});

// Colour stated rather than left to react-email, whose `Link` defaults to its own blue. It is
// only ever seen when images are blocked: what is painted then is the `alt`, and the alt reads
// "Rerun" right next to the wordmark.
const logoLink: React.CSSProperties = {
  color: theme.text.strong,
  display: "block",
  textDecoration: "none",
};

const logo: React.CSSProperties = {
  display: "block",
};

const organizationIcon: React.CSSProperties = {
  ...logo,
  borderRadius: theme.radius.inner,
};

const brandCell: React.CSSProperties = {
  verticalAlign: "middle",
};

// Weight 500, per the design system rule that headings are medium and never bold.
const wordmark: React.CSSProperties = {
  color: theme.text.strong,
  fontSize: "17px",
  fontWeight: 500,
  letterSpacing: "-0.02em",
  textDecoration: "none",
};
