# Clang AST Checker: Unchecked Malloc Returns

This repository contains a custom Clang compiler plugin built using AST Matchers. It performs static analysis on C source code to detect instances where dynamic memory allocation (`malloc`, `calloc`, `realloc`) is used without a preceding `NULL` check, preventing potential Segmentation Faults.

##  Features
- Matches `CallExpr` nodes for memory allocation functions.
- Tracks the assigned variables and checks for unsafe dereferences (e.g., `*ptr = 5` or `arr[0] = 10`).
- Validates the presence of control-flow guards (`if` statements).
- Emits custom compiler warnings with **Fix-It hints** directly in the terminal.

---

##  Prerequisites (Linux / WSL2)
To build and run this plugin, you must have the LLVM/Clang development libraries installed.

For Ubuntu/Debian, run:
```bash
sudo apt update
sudo apt install build-essential clang llvm-dev libclang-dev clang-tools cmake

```

---

##  Building the Plugin

We use CMake to link against the massive LLVM libraries. Run these commands from the root of the repository:

```bash
# 1. Create a build directory
mkdir build
cd build

# 2. Generate the Makefiles
cmake ..

# 3. Compile the shared library (.so)
make

```

*If successful, this will generate a `MallocCheckerPlugin.so` file inside your `build` directory.*

---

##  Running the Checker

You can test the plugin against the provided `test.c` file, which contains a mix of safe code, unsafe bugs, and edge cases.

From inside the `build` directory, run this Clang command to load the plugin:

```bash
clang -Xclang -load -Xclang ./MallocCheckerPlugin.so -Xclang -plugin -Xclang malloc-checker -fsyntax-only ../test.c

```

### Expected Output:

The compiler will analyze `test.c` and spit out warnings exactly where the bugs are, complete with code suggestions:

```text
../test.c:45:5: warning: Unchecked malloc return value! Potential null pointer dereference.
    emp->id = 404; 
    ^~~~~~~~~

```

---

## Analysis: Known Limitations (False Negatives)

Because this tool relies on AST (Abstract Syntax Tree) matching rather than full Control Flow Graph (CFG) execution, it has a few blind spots:

1. **Strict Ordering (Bad Control Flow):** The tool checks if an `if` guard exists *anywhere* in the function. If a programmer dereferences the pointer *first*, and writes the `if (ptr == NULL)` later in the function, the plugin will miss the bug.
2. **Pointer Aliasing:** If the returned pointer is copied to a new variable (e.g., `int *alias = ptr;`), the plugin only tracks the original variable and will not flag unsafe uses of the alias.
3. **Inter-procedural Flow:** If the pointer is passed into a helper function and dereferenced there, this AST matcher will miss it, as it only analyzes the body of the function where `malloc` was called.
