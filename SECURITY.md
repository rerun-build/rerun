# Security policy

## Reporting a vulnerability

Email **help@moldwright.robagentic.tech** with what you found, how to reproduce it, and what an attacker could
do with it. Please do not open a public issue for a vulnerability.

- We answer within **72 hours**.
- We fix it in private and ship the fix with the next release of this repository.
- We credit you in the release notes, unless you prefer not to be named.

Rerun Cloud and the open source build share the same code, so a vulnerability found here may also
affect hosted workspaces: please give us the time to fix it before publishing anything.

## Scope

Everything in this repository: the web app (`apps/ui`), the engine (`apps/engine`), the shared
packages and the database migrations. The self-hosting setup (`docker-compose.yml`) is in scope as
documented; a deployment that departs from the documentation is the responsibility of whoever runs it.
