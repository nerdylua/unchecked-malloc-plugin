// ============================================================================
// TEST: True Positive #3 — Struct Member Access and Ordering Violation
// ============================================================================
// EXPECTED: WARNINGS (2 warnings)
//
// This file tests two important cases:
//   1. Arrow operator (ptr->field) is an implicit dereference
//   2. Deref-before-guard: using the pointer BEFORE the NULL check
// ============================================================================

#include <stdlib.h>
#include <string.h>

typedef struct {
    int id;
    char name[50];
    double salary;
} Employee;

// Case 1: Struct member access via -> without any null check
// WARNING EXPECTED at: emp->id = 404
void struct_member_access() {
    Employee *emp = (Employee *)malloc(sizeof(Employee));
    emp->id = 404;
    strcpy(emp->name, "Ghost Employee");
    emp->salary = 0.0;
}

// Case 2: The pointer is dereferenced BEFORE the null check
// Our ordering-aware analysis should still catch this!
// WARNING EXPECTED at: *ptr = 5
void deref_before_guard() {
    int *ptr = (int *)malloc(sizeof(int));
    *ptr = 5;                    // BUG: used before the check below
    if (ptr == NULL) return;     // Too late — crash already happened
}
