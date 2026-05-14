#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m'

echo ""
echo -e "${CYAN}${BOLD}MallocGuard - Demo Launcher${NC}"
echo ""

echo -e "${YELLOW}[1/3]${NC} Building plugin..."
mkdir -p build && cd build
cmake .. > /dev/null 2>&1
make -j$(nproc) 2>&1 | tail -5
cd "$SCRIPT_DIR"

if [ ! -f "build/MallocCheckerPlugin.so" ]; then
    echo -e "${RED}Build failed! Check your LLVM/Clang installation.${NC}"
    exit 1
fi
echo -e "${GREEN}      Plugin built successfully${NC}"
echo ""

echo -e "${YELLOW}[2/3]${NC} Running test suite..."
echo ""
bash run_tests.sh
echo ""

echo -e "${YELLOW}[3/3]${NC} Launching web UI..."
echo -e "      Open ${BOLD}http://localhost:5000${NC} in your browser"
echo -e "      Press ${BOLD}Ctrl+C${NC} to stop"
echo ""
cd web
python3 server.py
