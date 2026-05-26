// ============================================================================
// TEST: True Negative #1 - Proper NULL Checks Before Use
// ============================================================================
// EXPECTED: NO WARNINGS (clean)
//
// This file contains properly-written code where every malloc/calloc/realloc
// return value is checked for NULL before being dereferenced.
// ============================================================================

#include <stdlib.h>
#include <stdio.h>
#include <string.h>

typedef struct {
    int id;
    char name[50];
} Record;

// Case 1: Explicit NULL comparison with error handling
void explicit_null_check() {
    int *ptr = (int *)malloc(sizeof(int));
    if (ptr == NULL) {
        fprintf(stderr, "malloc failed!\n");
        return;
    }
    *ptr = 42; // SAFE: guarded by the if-check above
    free(ptr);
}

// Case 2: Early return pattern for struct allocation
void struct_with_guard() {
    Record *rec = (Record *)malloc(sizeof(Record));
    if (rec == NULL) return;

    rec->id = 1;                      // SAFE
    strcpy(rec->name, "Safe Record"); // SAFE
    free(rec);
}

// Case 3: calloc with array access, properly guarded
void calloc_array_safe() {
    int *arr = (int *)calloc(100, sizeof(int));
    if (arr == NULL) return;

    arr[0] = 42;  // SAFE
    arr[99] = 99; // SAFE
    free(arr);
}

// Case 4: Function that returns a pointer - safe pattern
int *allocate_and_return() {
    int *data = (int *)malloc(sizeof(int) * 10);
    if (data == NULL) return NULL;

    data[0] = 1; // SAFE
    return data;
}
