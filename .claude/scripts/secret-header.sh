#!/bin/sh
# Prints an `Authorization: Bearer <secret>` header as JSON for an MCP server's
# `headersHelper`, reading the secret from ~/.claude/secrets/<name> so that no
# token is ever stored in a file that gets committed.
set -eu

name="${1:?usage: secret-header.sh <secret-file-name>}"
file="$HOME/.claude/secrets/$name"

if [ ! -r "$file" ]; then
  echo "secret-header.sh: cannot read $file (create it with the token, chmod 600)" >&2
  exit 1
fi

printf '{"Authorization":"Bearer %s"}' "$(tr -d '\r\n' < "$file")"
