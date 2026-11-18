# Runner image: python plus git, the gh CLI (Debian package, trixie) and an askpass helper. No token is baked
# in; the token reaches git at run time from the environment (FACTORY_GIT_TOKEN), only through the helper,
# and gh reads GH_TOKEN from the environment.
FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends git gh ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/* \
    && printf '%s\n' '#!/bin/sh' \
      'case "$1" in Username*) echo x-access-token ;; *) echo "$FACTORY_GIT_TOKEN" ;; esac' \
      > /usr/local/bin/git-askpass \
    && chmod 755 /usr/local/bin/git-askpass \
    && useradd --system --uid 10001 --create-home runner \
    && mkdir /state && chown 10001:10001 /state
ENV GIT_ASKPASS=/usr/local/bin/git-askpass GIT_TERMINAL_PROMPT=0
USER runner
WORKDIR /app
CMD ["python3", "-u", "/app/runner_loop.py", "run"]
