#!/bin/bash
# ============================================================================
# MallocGuard — Automated Test Suite Runner
# ============================================================================
# Builds the plugin (if needed) and runs all test files, comparing actual
# output against expected results (tp = expect warnings, tn = expect clean).
# ============================================================================

# ── Colors ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

# ── Config ──────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN="$SCRIPT_DIR/build/MallocCheckerPlugin.so"
TESTS_DIR="$SCRIPT_DIR/tests"
PASS=0
FAIL=0
TOTAL=0

# ── Header ──────────────────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}${BOLD}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}${BOLD}║   ⚡ MallocGuard — Automated Test Suite         ║${NC}"
echo -e "${CYAN}${BOLD}╚══════════════════════════════════════════════════╝${NC}"
echo ""

# ── Build Step ──────────────────────────────────────────────────────────────
if [ ! -f "$PLUGIN" ]; then
    echo -e "${YELLOW}[BUILD]${NC} Plugin not found. Compiling..."
    mkdir -p "$SCRIPT_DIR/build"
    cd "$SCRIPT_DIR/build"
    cmake .. > /dev/null 2>&1
    make -j$(nproc) 2>&1 | tail -3
    cd "$SCRIPT_DIR"
    if [ ! -f "$PLUGIN" ]; then
        echo -e "${RED}${BOLD}[BUILD] ✗ Build failed!${NC}"
        exit 1
    fi
    echo ""
fi
echo -e "${GREEN}[BUILD]${NC} Plugin ready: ${DIM}$PLUGIN${NC}"
echo ""

# ── Run Tests ───────────────────────────────────────────────────────────────
echo -e "${BOLD}Running tests...${NC}"
echo -e "${DIM}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

for test_file in "$TESTS_DIR"/*.c; do
    filename=$(basename "$test_file")
    TOTAL=$((TOTAL + 1))

    # Determine expectation from filename prefix
    if [[ "$filename" == tp* ]]; then
        EXPECT="WARNING"
    elif [[ "$filename" == tn* ]]; then
        EXPECT="CLEAN"
    else
        EXPECT="UNKNOWN"
    fi

    # Run the checker
    OUTPUT=$(clang -Xclang -load -Xclang "$PLUGIN" \
        -Xclang -plugin -Xclang malloc-checker \
        -fsyntax-only "$test_file" 2>&1)

    # Check for warnings in output
    if echo "$OUTPUT" | grep -q "warning:"; then
        GOT="WARNING"
    else
        GOT="CLEAN"
    fi

    # Compare
    echo ""
    echo -e "${MAGENTA}[TEST]${NC} ${BOLD}$filename${NC}"

    if [ "$GOT" == "WARNING" ]; then
        # Print each warning line indented
        echo "$OUTPUT" | grep -E "warning:|note:" | while read -r line; do
            echo -e "  ${YELLOW}⚠${NC}  $line"
        done
    fi

    if [ "$EXPECT" == "$GOT" ]; then
        echo -e "  Expected: ${BOLD}$EXPECT${NC} | Got: ${BOLD}$GOT${NC} | ${GREEN}${BOLD}✓ PASS${NC}"
        PASS=$((PASS + 1))
    else
        echo -e "  Expected: ${BOLD}$EXPECT${NC} | Got: ${BOLD}$GOT${NC} | ${RED}${BOLD}✗ FAIL${NC}"
        FAIL=$((FAIL + 1))
    fi
done

# ── Summary ─────────────────────────────────────────────────────────────────
echo ""
echo -e "${DIM}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
if [ "$FAIL" -eq 0 ]; then
    echo -e "${GREEN}${BOLD}Results: $PASS/$TOTAL passed ✓${NC}"
else
    echo -e "${RED}${BOLD}Results: $PASS/$TOTAL passed, $FAIL failed ✗${NC}"
fi
echo ""
