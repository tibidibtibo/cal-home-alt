#!/usr/bin/env bash
# Lance Cal-Home Alt en local : ./start.sh [--mock] [--lan] [--port N] [--dev] [--rebuild] [--no-browser]
set -euo pipefail
cd "$(dirname "$0")"
PY="$(command -v python3 || command -v python || true)"
[ -n "$PY" ] || { echo "Python 3.10+ introuvable." >&2; exit 1; }
exec "$PY" run.py "$@"
