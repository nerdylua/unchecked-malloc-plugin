cmake_minimum_required(VERSION 3.13)
project(MallocGuard LANGUAGES CXX)

# Require C++17 (needed by modern LLVM/Clang APIs)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# ── Find LLVM and Clang ─────────────────────────────────────────────────────
find_package(LLVM REQUIRED CONFIG)
message(STATUS "Found LLVM ${LLVM_PACKAGE_VERSION}")
message(STATUS "Using LLVMConfig.cmake in: ${LLVM_DIR}")

include_directories(${LLVM_INCLUDE_DIRS})
add_definitions(${LLVM_DEFINITIONS})

find_package(Clang REQUIRED CONFIG)
include_directories(${CLANG_INCLUDE_DIRS})

# ── Build the plugin shared library ──────────────────────────────────────────
add_library(MallocCheckerPlugin MODULE MallocChecker.cpp)

target_link_libraries(MallocCheckerPlugin
    PRIVATE
    clangAST
    clangASTMatchers
    clangBasic
    clangFrontend
    clangLex
    clangTooling
)

# Clang plugins must be built without RTTI
target_compile_options(MallocCheckerPlugin PRIVATE -fno-rtti)

# Output as a .so shared library (Linux/WSL)
set_target_properties(MallocCheckerPlugin PROPERTIES
    PREFIX ""
    SUFFIX ".so"
)