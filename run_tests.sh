#!/bin/bash

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN="$SCRIPT_DIR/build/MallocCheckerPlugin.so"
TESTS_DIR="$SCRIPT_DIR/testcases"
PASS=0
FAIL=0
TOTAL=0

echo ""
echo -e "${CYAN}${BOLD}MallocGuard - Automated Test Suite${NC}"
echo -e "${DIM}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

if [ ! -d "$TESTS_DIR" ]; then
    echo -e "${RED}[TEST] Testcase directory not found: $TESTS_DIR${NC}"
    exit 1
fi

if [ ! -f "$PLUGIN" ]; then
    echo -e "${YELLOW}[BUILD]${NC} Plugin not found. Compiling..."
    bash "$SCRIPT_DIR/build.sh" >/dev/null
    if [ ! -f "$PLUGIN" ]; then
        echo -e "${RED}[BUILD] Build failed!${NC}"
        exit 1
    fi
fi
echo -e "${GREEN}[BUILD]${NC} Plugin ready: ${DIM}$PLUGIN${NC}"
echo ""

for test_file in "$TESTS_DIR"/*.c; do
    filename=$(basename "$test_file")
    TOTAL=$((TOTAL + 1))

    if [[ "$filename" == tp* ]]; then
        EXPECT="WARNING"
    elif [[ "$filename" == tn* ]]; then
        EXPECT="CLEAN"
    else
        EXPECT="UNKNOWN"
    fi

    OUTPUT=$(clang -Xclang -load -Xclang "$PLUGIN" \
        -Xclang -plugin -Xclang malloc-checker \
        -fsyntax-only "$test_file" 2>&1)

    if echo "$OUTPUT" | grep -q "warning:"; then
        GOT="WARNING"
    else
        GOT="CLEAN"
    fi

    echo -e "${MAGENTA}[TEST]${NC} ${BOLD}$filename${NC}"

    if [ "$GOT" == "WARNING" ]; then
        echo "$OUTPUT" | grep -E "warning:|note:" | while read -r line; do
            echo -e "  ${YELLOW}>${NC}  $line"
        done
    fi

    if [ "$EXPECT" == "$GOT" ]; then
        echo -e "  Expected: ${BOLD}$EXPECT${NC} | Got: ${BOLD}$GOT${NC} | ${GREEN}${BOLD}PASS${NC}"
        PASS=$((PASS + 1))
    else
        echo -e "  Expected: ${BOLD}$EXPECT${NC} | Got: ${BOLD}$GOT${NC} | ${RED}${BOLD}FAIL${NC}"
        FAIL=$((FAIL + 1))
    fi
    echo ""
done

echo -e "${DIM}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
if [ "$FAIL" -eq 0 ]; then
    echo -e "${GREEN}${BOLD}Results: $PASS/$TOTAL passed${NC}"
else
    echo -e "${RED}${BOLD}Results: $PASS/$TOTAL passed, $FAIL failed${NC}"
fi
echo ""
