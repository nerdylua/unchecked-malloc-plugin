cmake_minimum_required(VERSION 3.10)
project(MallocChecker)

# Find LLVM and Clang
find_package(LLVM REQUIRED CONFIG)
include_directories(${LLVM_INCLUDE_DIRS})
add_definitions(${LLVM_DEFINITIONS})

find_package(Clang REQUIRED CONFIG)
include_directories(${CLANG_INCLUDE_DIRS})

# Our plugin source file (we will create this next)
add_library(MallocCheckerPlugin MODULE MallocChecker.cpp)

# Link against Clang libraries
target_link_libraries(MallocCheckerPlugin
    PRIVATE
    clangAST
    clangASTMatchers
    clangBasic
    clangFrontend
    clangLex
    clangTooling
)

# Plugins are shared libraries on Linux
set_target_properties(MallocCheckerPlugin PROPERTIES
    PREFIX ""
    SUFFIX ".so"
)