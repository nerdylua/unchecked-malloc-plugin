# IMPLEMENTATION

## LLVM and Clang Integration

The plugin source lives in `src/MallocChecker.cpp` and is built as
`build/MallocCheckerPlugin.so` by `CMakeLists.txt`. The target links against the
Clang libraries needed for frontend plugin analysis:

- `clangAST`
- `clangASTMatchers`
- `clangBasic`
- `clangFrontend`
- `clangLex`
- `clangTooling`

The plugin is registered with:

```cpp
static FrontendPluginRegistry::Add<MallocCheckerAction>
    X("malloc-checker", "Detects unchecked malloc/calloc/realloc return values");
```

It is loaded by Clang with:

```bash
clang -Xclang -load -Xclang ./build/MallocCheckerPlugin.so \
      -Xclang -plugin -Xclang malloc-checker \
      -fsyntax-only testcases/tp1_basic_deref.c
```

## AST Matcher Pipeline

`MallocCheckerAction` creates a `MatchFinder` and registers two top-level
matchers.

The initialization matcher catches declarations like:

```c
int *p = (int *)malloc(sizeof(int));
```

It binds the variable as `malloc_var` and the allocation call as `malloc_call`.

The assignment matcher catches:

```c
p = (int *)calloc(4, sizeof(int));
```

It binds the assigned variable as `assign_var` and the call as `assign_call`.

Both matchers use `functionDecl(hasAnyName("malloc", "calloc", "realloc"))` so
the checker covers the three allocation APIs required for the project.

## Dereference Detection

For every matched allocation variable, the callback searches the enclosing
function body for three dereference shapes:

- `unaryOperator(hasOperatorName("*"))` for `*ptr`
- `arraySubscriptExpr` for `ptr[index]`
- `memberExpr(isArrow())` for `ptr->field`

The matcher uses `equalsNode(Var)` so only dereferences of the specific matched
allocation variable are considered.

## Guard Detection and Ordering

The checker searches for `ifStmt` nodes whose condition contains a reference to
the same variable. This recognizes common patterns such as:

```c
if (ptr == NULL) return;
if (!ptr) return;
if (a == NULL || b == NULL) return;
```

It then uses `SourceManager::isBeforeInTranslationUnit` to make the analysis
ordering-aware. A guard that appears after a dereference is treated as too late
and still produces a warning.

## Diagnostics and Fix-Its

Warnings are emitted through Clang's `DiagnosticsEngine`:

- Warning at the first unchecked dereference.
- Note at the original allocation call.
- Fix-it insertion before the dereference.

The fix-it is context-aware:

- `void` functions suggest `return;`
- pointer-returning functions suggest `return NULL;`
- integer-returning functions suggest `return -1;`, or `return 1;` for `main`

## Flask Realtime Runner

`web/server.py` exposes the checker through Flask:

- `POST /analyze` writes submitted C code to a temporary file, runs the plugin,
  parses warnings, notes, errors, fix-its, and records plugin runtime in
  milliseconds.
- `POST /ast` runs `clang -Xclang -ast-dump` on the same submitted code, parses
  the tree, filters compiler/builtin noise, and records AST generation time.
- `GET /presets` loads examples from `testcases/` so every test case is
  available in the browser dropdown.

`web/app.js` runs `/analyze` and `/ast` concurrently. The UI shows line
highlights, diagnostic cards, raw Clang output, one-click fix-it insertion, AST
graph/list views, and live footer timings such as `Plugin: 24ms | AST: 31ms`.
