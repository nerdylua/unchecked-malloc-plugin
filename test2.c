#include <stdlib.h>
#include <stdio.h>
#include <string.h>

// --- REAL-WORLD STRUCT ---
typedef struct {
    int id;
    char name[50];
    double salary;
} Employee;


// ==========================================
// 1. TRUE NEGATIVES (Safe code - NO WARNINGS)
// ==========================================

void process_employee_safe() {
    Employee *emp = (Employee *)malloc(sizeof(Employee));
    if (emp == NULL) {
        fprintf(stderr, "Memory allocation failed!\n");
        return;
    }
    // Safe to use because of the check above
    emp->id = 101; 
    strcpy(emp->name, "John Doe");
}

void init_array_safe() {
    int *arr = (int *)calloc(100, sizeof(int));
    if (!arr) return; // Shorthand check

    arr[0] = 42;      // Safe
}


// ==========================================
// 2. TRUE POSITIVES (Bugs - EXPECT WARNINGS)
// ==========================================

void process_employee_unsafe() {
    Employee *emp = (Employee *)malloc(sizeof(Employee));
    
    // WARNING EXPECTED: Missing NULL check before struct dereference!
    emp->id = 404; 
}

void resize_array_unsafe() {
    int *arr = (int *)malloc(10 * sizeof(int));
    if (!arr) return; // Checked the first one

    // WARNING EXPECTED: realloc can fail and return NULL, losing the original pointer!
    int *new_arr = (int *)realloc(arr, 20 * sizeof(int));
    new_arr[15] = 99; 
}


// ==========================================
// 3. THE "UGLY" BLIND SPOTS (False Negatives)
// ==========================================

void bad_control_flow_miss() {
    int *ptr = (int *)malloc(sizeof(int));
    
    *ptr = 5; // Bug! Dereferenced BEFORE the check.
    
    // Because this IF exists anywhere in the function, our AST matcher 
    // gets tricked into thinking the pointer is safe. No warning emitted.
    if (ptr == NULL) return; 
}

void pointer_aliasing_miss() {
    int *original = (int *)malloc(sizeof(int));
    int *alias = original; 
    
    // The plugin tracks 'original', so it won't see this dereference of 'alias'!
    *alias = 10; 
}

// Inter-procedural helper
void set_value(int *p) {
    *p = 100;
}

void inter_procedural_miss() {
    int *ptr = (int *)malloc(sizeof(int));
    // Plugin only searches the current function body, so it misses the bug inside set_value!
    set_value(ptr);
}