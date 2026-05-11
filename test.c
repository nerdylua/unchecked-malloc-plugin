#include <stdlib.h>

void my_function() {
    // 1. The Bad: Unchecked malloc
    int *bad_ptr = (int *)malloc(sizeof(int));
    *bad_ptr = 5; 

    // 2. The Good: Checked malloc
    int *good_ptr = (int *)malloc(sizeof(int));
    if (good_ptr != NULL) {
        *good_ptr = 10;
    }
}