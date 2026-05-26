# EVALUATION

## Metrics

The project is evaluated on correctness, coverage, speed, and usability:

| Metric | Result |
|---|---|
| Automated test cases | 6 C files in `testcases/` |
| Required minimum tests | Satisfied: 6 >= 5 |
| True positive files | 4 files |
| True negative files | 2 files |
| Allocation APIs covered | `malloc`, `calloc`, `realloc` |
| Dereference forms covered | `*ptr`, `ptr[i]`, `ptr->field` |
| Required script entrypoints | `./build.sh` and `./run.sh` |
| Realtime UI | Flask app accepts arbitrary pasted C code |
| AST support | Web app builds and visualizes Clang AST dumps |
| Speed instrumentation | Plugin and AST timings displayed in milliseconds |

The Flask UI reports actual runtime for every submitted snippet in the footer.
On the small included tests, this should normally be interactive because the
checker is a frontend-only AST matcher pass and does not perform path-sensitive
fixpoint analysis.

## Baseline Comparison

| Approach | Result on Project Cases | Tradeoff |
|---|---|---|
| Naive grep/text search | Can find allocation names but cannot reliably pair variables, guards, and dereferences | Fast but structurally inaccurate |
| Naive AST checker that only asks "does any guard mention this variable?" | Misses `deref_before_guard`, because a later guard would incorrectly look safe | Simple but not ordering-aware |
| MallocGuard AST matcher | Catches unchecked direct dereferences and catches deref-before-guard by comparing source locations | Fast and source-aware, but not full data-flow |
| Clang Static Analyzer / scan-build style CFG analysis | Can catch more path-sensitive and aliasing cases | More complex and heavier than this assignment requires |

MallocGuard improves over the naive baselines by using Clang's structured AST
and by checking source order. It intentionally remains simpler and faster than a
full static analyzer.

## Test Cases

| File | Type | What It Tests |
|---|---|---|
| `testcases/tp1_basic_deref.c` | True Positive | Direct `*ptr` dereference and separate assignment after `malloc` |
| `testcases/tp2_array_access.c` | True Positive | `calloc` array access and unchecked `realloc` result |
| `testcases/tp3_struct_member.c` | True Positive | `ptr->field` access and dereference before a later guard |
| `testcases/tp4_pointer_return_fixit.c` | True Positive | Pointer-returning function should suggest `return NULL` fix-it |
| `testcases/tn1_null_check.c` | True Negative | Explicit `== NULL` guards before dereference |
| `testcases/tn2_shorthand_check.c` | True Negative | `if (!ptr)`, combined guards, and safe `realloc` pattern |

Run the suite with:

```bash
./run.sh
```

Expected summary:

```text
Results: 6/6 passed
```

## Known Limitations

The checker is intentionally AST-based. It does not fully handle aliases,
inter-procedural dereferences, path-sensitive branch reasoning, function-pointer
allocators, or conditional allocation state. These are discussed in more detail
in `ANALYSIS.md`.
