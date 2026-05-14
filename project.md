# Assignment 6 — Clang AST Checker for Unchecked Malloc Return Values

**Description:** Write a Clang AST matcher plugin that detects calls to `malloc()` (or `calloc`/`realloc`) whose return value is used without a preceding `NULL` check, and emits a custom warning with a fix-it hint.

**Background:** A common C bug is using a pointer returned by `malloc()` without checking if it is `NULL` (allocation failure). Clang's AST Matchers provide a declarative DSL for pattern-matching the AST — a powerful way to build custom static analysis tools without writing a full checker in the Clang Static Analyzer.

**Objective:** Build a Clang plugin that:
(a) matches any `CallExpr` to `malloc`/`calloc`/`realloc`;
(b) checks whether the return value flows into a dereference or array access without a null-guard on any path;
(c) emits a `DiagnosticsEngine` warning with a suggested fix-it.

**Deliverables:**
* A Clang plugin (shared library) using `ASTMatchFinder`
* At least 5 test `.c` files: 3 true positives, 2 true negatives (checked mallocs)
* A `CMakeLists.txt` that builds the plugin against your LLVM install
* Analysis: what class of bugs does this miss? (false negatives)