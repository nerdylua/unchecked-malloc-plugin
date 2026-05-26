#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN="$SCRIPT_DIR/build/MallocCheckerPlugin.so"
TARGET="${1:-}"

if [ ! -f "$PLUGIN" ]; then
    bash "$SCRIPT_DIR/build.sh"
fi

if [ -n "$TARGET" ]; then
    clang -Xclang -load -Xclang "$PLUGIN" \
        -Xclang -plugin -Xclang malloc-checker \
        -fsyntax-only "$TARGET"
else
    bash "$SCRIPT_DIR/run_tests.sh"
fi
