// ============================================================================
// TEST: True Positive #2 — Array Access Without Null Check
// ============================================================================
// EXPECTED: WARNINGS (2 warnings)
//
// This file tests array subscript access (ptr[i]) on pointers returned by
// calloc() and realloc() without a preceding NULL check.
// ============================================================================

#include <stdlib.h>

// Case 1: calloc returns a zeroed buffer, but can still fail
// WARNING EXPECTED at: arr[0] = 100
void calloc_array_access() {
    int *arr = (int *)calloc(10, sizeof(int));
    arr[0] = 100;
    arr[5] = 200;
}

// Case 2: realloc can fail even when the original malloc succeeded
// WARNING EXPECTED at: new_arr[15] = 99
void realloc_without_check() {
    int *arr = (int *)malloc(10 * sizeof(int));
    if (!arr) return; // Original allocation is properly checked

    // BUG: realloc can return NULL, losing the original pointer!
    int *new_arr = (int *)realloc(arr, 20 * sizeof(int));
    new_arr[15] = 99;
}
