// ============================================================================
// TEST: True Positive #4 - Pointer Return Fix-It Hint
// ============================================================================
// EXPECTED: WARNING (1 warning)
//
// This case verifies that the checker still reports unchecked array access in a
// function that returns a pointer. The plugin should suggest `return NULL` in
// its fix-it hint, not a bare `return`.
// ============================================================================

#include <stdlib.h>

int *make_default_buffer() {
    int *values = (int *)calloc(4, sizeof(int));
    values[0] = 7;
    return values;
}
