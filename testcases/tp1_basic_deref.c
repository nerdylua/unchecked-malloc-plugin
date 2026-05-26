// ============================================================================
// TEST: True Positive #1 - Basic Pointer Dereference Without Null Check
// ============================================================================
// EXPECTED: WARNINGS (2 warnings)
//
// This file tests the most fundamental case: a pointer returned by malloc()
// is immediately dereferenced with the * operator, with no NULL check.
// Also tests the separate-assignment pattern (ptr = malloc after declaration).
// ============================================================================

#include <stdlib.h>

// Case 1: Direct initialization + unchecked dereference
// WARNING EXPECTED at: *ptr = 42
void basic_malloc_deref() {
    int *ptr = (int *)malloc(sizeof(int));
    *ptr = 42;
}

// Case 2: Separate declaration and assignment
// WARNING EXPECTED at: *data = 100
void separate_assignment_deref() {
    double *data;
    data = (double *)malloc(sizeof(double));
    *data = 100.0;
}
