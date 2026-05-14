# ⚡ MallocGuard — Clang AST Checker for Unchecked Malloc Returns

A custom Clang compiler plugin that uses AST Matchers to perform static analysis
on C source code, detecting instances where dynamic memory allocation (`malloc`,
`calloc`, `realloc`) is used without a preceding `NULL` check.

---

## Features

- **Ordering-aware analysis** — only counts null-guards that appear *before* the dereference
- **Multiple dereference forms** — detects `*ptr`, `ptr[i]`, and `ptr->member`
- **Two allocation patterns** — matches both `int *p = malloc(...)` and `p = malloc(...)`
- **Context-aware Fix-It hints** — suggests `return`, `return NULL`, or `return 1` based on function signature
- **Note diagnostics** — points back to the allocation site for easy navigation
- **Live web UI** — paste C code and see results rendered inline (see [Web Demo](#-web-demo))

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
# From the project root
mkdir -p build && cd build
cmake ..
make -j$(nproc)
```

This produces `build/MallocCheckerPlugin.so`.

---

## Running the Checker

### Manual (single file)

```bash
clang -Xclang -load -Xclang ./build/MallocCheckerPlugin.so \
      -Xclang -plugin -Xclang malloc-checker \
      -fsyntax-only tests/tp1_basic_deref.c
```

### Automated Test Suite

```bash
chmod +x run_tests.sh
./run_tests.sh
```

Expected output:

```
╔══════════════════════════════════════════════════╗
║   ⚡ MallocGuard — Automated Test Suite         ║
╚══════════════════════════════════════════════════╝

[BUILD] Plugin ready: ./build/MallocCheckerPlugin.so

[TEST] tn1_null_check.c
  Expected: CLEAN   | Got: CLEAN   | ✓ PASS

[TEST] tn2_shorthand_check.c
  Expected: CLEAN   | Got: CLEAN   | ✓ PASS

[TEST] tp1_basic_deref.c
  ⚠  warning: potential null pointer dereference...
  Expected: WARNING | Got: WARNING | ✓ PASS

[TEST] tp2_array_access.c
  ⚠  warning: potential null pointer dereference...
  Expected: WARNING | Got: WARNING | ✓ PASS

[TEST] tp3_struct_member.c
  ⚠  warning: potential null pointer dereference...
  Expected: WARNING | Got: WARNING | ✓ PASS

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Results: 5/5 passed ✓
```

---

## 🌐 Web Demo

A live web interface for interactive analysis:

```bash
cd web
python3 server.py
# Open http://localhost:5000 in your browser
```

**Features:**
- Dark-themed code editor with line numbers
- Warning indicators on affected lines
- Diagnostic cards with Fix-It suggestions
- "Apply Fix" button to patch code in-editor
- Preset test files loadable from dropdown

---

## Test Files

| File | Type | What It Tests |
|---|---|---|
| `tests/tp1_basic_deref.c` | True Positive | `*ptr` dereference, separate assignment |
| `tests/tp2_array_access.c` | True Positive | `arr[i]` access, `realloc` without check |
| `tests/tp3_struct_member.c` | True Positive | `ptr->field` access, deref-before-guard |
| `tests/tn1_null_check.c` | True Negative | Explicit `== NULL`, early return, function return |
| `tests/tn2_shorthand_check.c` | True Negative | `if (!ptr)`, combined checks, safe realloc |

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
├── MallocChecker.cpp           # Plugin source (AST matcher + callback)
├── CMakeLists.txt              # Build configuration
├── run_tests.sh                # Automated test runner
├── ANALYSIS.md                 # Detailed false-negative analysis
├── README.md                   # This file
├── tests/
│   ├── tp1_basic_deref.c       # True positive: basic *ptr
│   ├── tp2_array_access.c      # True positive: arr[i]
│   ├── tp3_struct_member.c     # True positive: struct->field
│   ├── tn1_null_check.c        # True negative: proper checks
│   └── tn2_shorthand_check.c   # True negative: shorthand checks
├── web/
│   ├── index.html              # Web UI
│   ├── style.css               # Dark theme
│   ├── app.js                  # Frontend logic
│   └── server.py               # Flask backend
└── build/                      # Compiled plugin (.so)
```
