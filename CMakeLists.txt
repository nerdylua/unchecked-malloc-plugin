cmake_minimum_required(VERSION 3.13)
project(MallocGuard LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(LLVM REQUIRED CONFIG)
message(STATUS "Found LLVM ${LLVM_PACKAGE_VERSION}")
include_directories(${LLVM_INCLUDE_DIRS})
add_definitions(${LLVM_DEFINITIONS})

find_package(Clang REQUIRED CONFIG)
include_directories(${CLANG_INCLUDE_DIRS})

add_library(MallocCheckerPlugin MODULE src/MallocChecker.cpp)

target_link_libraries(MallocCheckerPlugin
    PRIVATE
    clangAST
    clangASTMatchers
    clangBasic
    clangFrontend
    clangLex
    clangTooling
)

target_compile_options(MallocCheckerPlugin PRIVATE -fno-rtti)

set_target_properties(MallocCheckerPlugin PROPERTIES
    PREFIX ""
    SUFFIX ".so"
)