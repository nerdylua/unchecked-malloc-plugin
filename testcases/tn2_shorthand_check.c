// ============================================================================
// TEST: True Negative #2 - Shorthand and Idiomatic NULL Checks
// ============================================================================
// EXPECTED: NO WARNINGS (clean)
//
// This file tests idiomatic C patterns for null-checking that experienced
// programmers commonly use: shorthand (!ptr), combined checks, etc.
// ============================================================================

#include <stdlib.h>
#include <stdio.h>

// Case 1: Shorthand boolean negation - if (!ptr)
void shorthand_not_check() {
    int *ptr = (int *)malloc(sizeof(int));
    if (!ptr) return;

    *ptr = 42; // SAFE: guarded by if (!ptr)
    free(ptr);
}

// Case 2: Multiple allocations with a combined guard
void multiple_allocs_checked() {
    int *a = (int *)malloc(sizeof(int));
    int *b = (int *)malloc(sizeof(int));
    if (a == NULL || b == NULL) {
        free(a);
        free(b);
        return;
    }

    *a = 1; // SAFE
    *b = 2; // SAFE
    free(a);
    free(b);
}

// Case 3: realloc with proper check (safe pattern)
void safe_realloc() {
    int *arr = (int *)malloc(10 * sizeof(int));
    if (!arr) return;

    int *tmp = (int *)realloc(arr, 20 * sizeof(int));
    if (tmp == NULL) {
        free(arr); // Original pointer is preserved
        return;
    }
    arr = tmp;

    arr[15] = 99; // SAFE: realloc result was checked
    free(arr);
}
