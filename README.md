# MallocGuard: Clang AST Checker for Unchecked Malloc Returns

MallocGuard is a custom Clang/LLVM compiler plugin that uses AST Matchers to
detect C code where dynamic memory allocation (`malloc`, `calloc`, `realloc`) is
dereferenced without a preceding `NULL` check.

The project also includes a Flask web app that runs the compiled plugin on any
pasted C code in real time. The web app shows diagnostics, one-click fix-it
hints, a visual AST, raw Clang output, and live millisecond timings for both the
plugin pass and AST generation.

---

## Features

- **Ordering-aware analysis** — only counts null-guards that appear *before* the dereference
- **Multiple dereference forms** — detects `*ptr`, `ptr[i]`, and `ptr->member`
- **Two allocation patterns** — matches both `int *p = malloc(...)` and `p = malloc(...)`
- **Context-aware Fix-It hints** — suggests `return`, `return NULL`, or `return 1` based on function signature
- **Note diagnostics** — points back to the allocation site for easy navigation
- **Live Flask UI** — paste any C snippet and see plugin results rendered inline
- **AST visualization** — builds a Clang AST dump and renders graph/list views
- **Speed metrics** — reports plugin and AST generation time for each run

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Clang Frontend                          │
│  Source.c ──→ Lexer ──→ Parser ──→ AST                        │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │  ASTMatchFinder      │
                    │  ┌────────────────┐  │
                    │  │ InitMatcher    │──┤──→ VarDecl + CallExpr
                    │  │ AssignMatcher  │──┤──→ BinaryOp + CallExpr
                    │  └────────────────┘  │
                    └──────────┬───────────┘
                               │
                    ┌──────────▼──────────┐
                    │  MallocCallback      │
                    │                      │
                    │  1. Find all derefs  │  *ptr, ptr[i], ptr->m
                    │  2. Find all guards  │  if (ptr == NULL)
                    │  3. Compare ordering │  guard.loc < deref.loc?
                    │  4. Emit diagnostic  │  warning + note + fix-it
                    └──────────────────────┘
```

---

## Prerequisites (Linux / WSL)

```bash
sudo apt update
sudo apt install build-essential clang llvm-dev libclang-dev cmake
```

For the web demo, also install:

```bash
pip install flask flask-cors
```

---

## Building the Plugin

```bash
chmod +x build.sh run.sh run_tests.sh
./build.sh
```

This produces `build/MallocCheckerPlugin.so`.

---

## Running the Checker

### Manual (single file)

```bash
./run.sh testcases/tp1_basic_deref.c
```

### Automated Test Suite

```bash
./run.sh
# or: ./run_tests.sh
```

Expected output:

```
MallocGuard - Automated Test Suite
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[BUILD] Plugin ready: ./build/MallocCheckerPlugin.so

[TEST] tp1_basic_deref.c
  >  warning: potential null pointer dereference...
  Expected: WARNING | Got: WARNING | PASS

[TEST] tp2_array_access.c
  >  warning: potential null pointer dereference...
  Expected: WARNING | Got: WARNING | PASS

[TEST] tp3_struct_member.c
  >  warning: potential null pointer dereference...
  Expected: WARNING | Got: WARNING | PASS

[TEST] tp4_pointer_return_fixit.c
  >  warning: potential null pointer dereference...
  Expected: WARNING | Got: WARNING | PASS

[TEST] tn1_null_check.c
  Expected: CLEAN   | Got: CLEAN   | PASS

[TEST] tn2_shorthand_check.c
  Expected: CLEAN   | Got: CLEAN   | PASS

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Results: 6/6 passed
```

---

## Web Demo

A live Flask interface for interactive analysis of arbitrary C code:

```bash
./build.sh
cd web && python3 server.py
# Open http://localhost:5000 in your browser
```

**Features:**
- **Results View:** Dark-themed code editor with line numbers, warning indicators, and diagnostic cards with one-click "Apply Fix"
- **AST View:** Interactive Abstract Syntax Tree visualization
  - **Graph Mode:** D3-style SVGs with color-coded nodes, pan/zoom, and curved bezier edges
  - **List Mode:** Collapsible, indented tree structure
- **Live Metrics:** Real-time execution timings for the plugin and AST generator shown in the footer
- **Presets:** Pre-loaded test cases (True Positives and True Negatives) available from the dropdown

---

## Test Files

| File | Type | What It Tests |
|---|---|---|
| `testcases/tp1_basic_deref.c` | True Positive | `*ptr` dereference, separate assignment |
| `testcases/tp2_array_access.c` | True Positive | `arr[i]` access, `realloc` without check |
| `testcases/tp3_struct_member.c` | True Positive | `ptr->field` access, deref-before-guard |
| `testcases/tp4_pointer_return_fixit.c` | True Positive | pointer-return fix-it should use `return NULL` |
| `testcases/tn1_null_check.c` | True Negative | Explicit `== NULL`, early return, function return |
| `testcases/tn2_shorthand_check.c` | True Negative | `if (!ptr)`, combined checks, safe realloc |

See `EVALUATION.md` for metrics, baseline comparison, and testcase rationale.

---

## Known Limitations (False Negatives)

See [ANALYSIS.md](ANALYSIS.md) for a detailed write-up. In summary:

1. **Pointer aliasing** — `int *alias = ptr; *alias = 5;` is not tracked
2. **Inter-procedural flow** — dereferences inside called functions are not seen
3. **Complex control flow** — only source-location ordering, not full CFG analysis
4. **Function pointers** — indirect calls like `alloc_fn(sizeof(int))` are not matched
5. **Conditional allocation** — allocation inside branches can be missed

---

## Project Structure

```
cd-lab/
├── src/
│   └── MallocChecker.cpp       # Plugin source (AST matcher + callback)
├── CMakeLists.txt              # Build configuration
├── build.sh                    # Required build script
├── run.sh                      # Required runner script
├── run_tests.sh                # Automated test runner
├── DESIGN.md                   # Approach and alternatives
├── IMPLEMENTATION.md           # LLVM/Clang implementation details
├── EVALUATION.md               # Metrics, comparison, and test cases
├── ANALYSIS.md                 # Detailed false-negative analysis
├── README.md                   # This file
├── testcases/
│   ├── tp1_basic_deref.c       # True positive: basic *ptr
│   ├── tp2_array_access.c      # True positive: arr[i]
│   ├── tp3_struct_member.c     # True positive: struct->field
│   ├── tp4_pointer_return_fixit.c
│   ├── tn1_null_check.c        # True negative: proper checks
│   └── tn2_shorthand_check.c   # True negative: shorthand checks
├── web/
│   ├── index.html              # Web UI
│   ├── style.css               # Dark theme
│   ├── app.js                  # Frontend logic
│   └── server.py               # Flask backend
└── build/                      # Compiled plugin (.so)
```
