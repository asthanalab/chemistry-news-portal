#!/bin/zsh
cd -- "${0:A:h}"
if command -v node >/dev/null 2>&1; then
  newsroom_node="$(command -v node)"
else
  newsroom_node="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
fi
if [[ ! -x "$newsroom_node" ]]; then
  print "Node.js 20 or later is required. Install it, then run: node server.mjs"
  exit 1
fi
exec "$newsroom_node" server.mjs
