# DESIGN

## Goal

MallocGuard is a lightweight Clang plugin for finding C code that dereferences
memory returned by `malloc`, `calloc`, or `realloc` before checking for `NULL`.
The project is designed for fast feedback: it can run from the command line over
test cases, or through a Flask web app where users paste any C snippet and see
diagnostics, fix-it hints, AST structure, and timing metrics in real time.

## Approach

The checker uses Clang AST Matchers instead of a full data-flow framework. The
main design is:

1. Match allocation sites where a `VarDecl` is initialized from `malloc`,
   `calloc`, or `realloc`.
2. Match separate assignment sites such as `ptr = malloc(...)`.
3. For the allocated variable's enclosing function, find syntactic dereference
   forms: `*ptr`, `ptr[i]`, and `ptr->field`.
4. Find `if` statements whose condition references that variable.
5. Compare source locations so a guard only counts if it appears before the
   first dereference.
6. Emit a Clang warning, a note pointing back to the allocation, and a fix-it
   hint tailored to the enclosing function's return type.

The Flask app extends the command-line checker into an interactive tool. It
writes submitted code to a temporary C file, runs the compiled plugin with
`clang -fsyntax-only`, parses Clang diagnostics and fix-its, separately asks
Clang for an AST dump, and returns both results as JSON for the browser UI.

## Alternatives Considered

### Clang Static Analyzer Checker

A Clang Static Analyzer checker would provide stronger path sensitivity and
could reason about branch-specific guards. It was not chosen because the setup is
heavier than this project needs. Fast compile-time feedback and understandable
matcher code were more important.

### LLVM IR Pass

An LLVM IR pass can analyze optimized pointer operations, but by that point C
source-level intent and easy fix-it insertion are harder to preserve. The project
needs user-facing source diagnostics, so Clang frontend analysis is a better fit.

### Text or Regex Scanner

A regex scanner would be simpler, but it would confuse comments, casts, macros,
declarations, and expressions. Clang's AST gives structured nodes such as
`CallExpr`, `VarDecl`, `UnaryOperator`, `ArraySubscriptExpr`, and `MemberExpr`,
which makes the checker much more reliable.

### Full CFG/Data-Flow Analysis

CFG-based data-flow could track aliases, branch reachability, and
inter-procedural calls. It was kept as a documented future improvement because it
adds significant complexity and would be slower than the current AST-only pass.

## Tradeoffs

The AST matcher design is fast, readable, and easy to demo. The main tradeoff is
precision: the checker handles common direct unchecked uses, but it does not
model aliases, function calls, or all control-flow paths. These limits are
documented in `ANALYSIS.md` and reflected in the evaluation comparison.
