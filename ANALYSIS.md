# Analysis: False Negatives and Limitations

This document provides a detailed analysis of what our Clang AST Checker catches,
what it misses, and why — as required by the assignment deliverables.

---

## What We Catch

Our plugin detects unchecked dereferences across **three patterns**:

| Dereference Form | Example | AST Node Matched |
|---|---|---|
| Pointer dereference | `*ptr = 5;` | `unaryOperator(hasOperatorName("*"))` |
| Array subscript | `arr[0] = 42;` | `arraySubscriptExpr` |
| Arrow (struct member) | `emp->id = 1;` | `memberExpr(isArrow())` |

We also handle two allocation patterns:

| Allocation Pattern | Example |
|---|---|
| Initialized declaration | `int *p = malloc(...)` |
| Separate assignment | `int *p; p = malloc(...)` |

Our analysis is **ordering-aware**: a null-guard is only valid if it appears
*before* the dereference in the translation unit. This is a significant
improvement over naive AST checkers that just look for "any if-statement
mentioning the variable."

---

## What We Miss (False Negatives)

### 1. Pointer Aliasing

```c
int *original = (int *)malloc(sizeof(int));
int *alias = original;
*alias = 10;  // ← MISSED: we only track 'original', not 'alias'
```

**Why:** Our matcher binds the variable at the point of allocation. When the
pointer is copied to another variable, the new variable is not tracked. To
fix this, we would need data-flow analysis to propagate "tainted" status
through assignments — this requires a CFG-based approach, not just AST matching.

### 2. Inter-Procedural Flow

```c
void set_value(int *p) {
    *p = 100;  // ← MISSED: dereference happens in a different function
}

void caller() {
    int *ptr = (int *)malloc(sizeof(int));
    set_value(ptr);  // Passes unchecked pointer
}
```

**Why:** Our plugin only searches the body of the function where `malloc` was
called. To catch this, we would need a call-graph and inter-procedural analysis
— essentially what the full Clang Static Analyzer does.

### 3. Complex Control Flow

```c
int *ptr = (int *)malloc(sizeof(int));
if (some_unrelated_condition) {
    *ptr = 5;  // ← NOT CAUGHT if any if-guard mentioning ptr exists elsewhere
}
```

While our ordering check helps with the simple `deref-before-guard` case,
we cannot handle:
- Dereferences inside branches that aren't guarded by the null check
- Multiple execution paths where some are safe and some aren't
- Loop-carried dereferences

**Why:** AST matchers operate on the syntax tree, not the Control Flow Graph (CFG).
They cannot reason about which branches are actually taken or how control flows
between statements.

### 4. Function Pointer / Indirect Calls

```c
void *(*alloc_fn)(size_t) = malloc;
int *ptr = (int *)alloc_fn(sizeof(int));
*ptr = 42;  // ← MISSED: we only match direct calls to malloc/calloc/realloc
```

**Why:** Our matcher uses `callee(functionDecl(hasAnyName(...)))`, which only
matches direct function calls. Function pointers create `CallExpr` nodes with
a `DeclRefExpr` to a variable, not a `FunctionDecl`.

### 5. Conditional Allocation

```c
int *ptr = NULL;
if (need_memory) {
    ptr = malloc(sizeof(int));
}
*ptr = 42;  // ← MISSED or FALSE POSITIVE depending on matcher behavior
```

**Why:** The allocation is conditional, meaning `ptr` might or might not be
allocated. Our matcher would either miss the assignment (if it's inside a
branch) or flag it incorrectly.

---

## AST Matching vs. CFG Analysis: The Fundamental Tradeoff

| Aspect | AST Matchers (Our Approach) | CFG / Data-Flow Analysis |
|---|---|---|
| **Complexity** | Low — declarative DSL | High — requires fixpoint iteration |
| **Speed** | Very fast | Slower, proportional to CFG size |
| **Ordering** | Limited (source location comparison) | Full path-sensitivity |
| **Aliasing** | Not supported | Supported via points-to analysis |
| **Inter-procedural** | Not supported | Supported via call-graph |
| **False negatives** | Higher | Lower |
| **False positives** | Lower (conservative matching) | Can be lower with precision |

Our AST-based approach is ideal for **fast, lightweight checks** that catch
the most common bugs (direct dereference without any check). For production-grade
analysis, tools like the Clang Static Analyzer, Coverity, or Infer use
CFG-based approaches with data-flow frameworks.

---

## Comparison with Existing Tools

| Tool | Approach | Catches Aliasing? | Inter-Procedural? |
|---|---|---|---|
| **MallocGuard (ours)** | AST Matchers | ❌ | ❌ |
| `scan-build` (Clang SA) | CFG + Symbolic Execution | ✅ | Partial |
| `cppcheck` | AST + Data-flow | ✅ | Partial |
| Facebook Infer | Abstract Interpretation | ✅ | ✅ |
| Coverity | Advanced Data-flow | ✅ | ✅ |

Our tool occupies a useful niche: it's **simple, fast, and easy to understand**,
making it suitable for educational purposes and as a first-pass lint check.
