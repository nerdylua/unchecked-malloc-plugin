// ============================================================================
// MallocGuard — Clang AST Checker for Unchecked Malloc Return Values
// ============================================================================
//
// A Clang plugin that uses AST Matchers to detect calls to malloc(), calloc(),
// and realloc() whose return value is dereferenced without a preceding NULL
// check. Emits custom warnings with contextual fix-it hints.
//
// Key features over a naive implementation:
//   1. Ordering-aware: checks that the null-guard appears BEFORE the deref
//   2. Matches both `int *p = malloc(...)` and `p = malloc(...)` patterns
//   3. Detects *, [], and -> dereference forms
//   4. Context-aware fix-it (void/int/pointer return types)
//   5. Note diagnostic pointing back to the allocation site
// ============================================================================

#include "clang/ASTMatchers/ASTMatchFinder.h"
#include "clang/ASTMatchers/ASTMatchers.h"
#include "clang/Frontend/CompilerInstance.h"
#include "clang/Frontend/FrontendPluginRegistry.h"
#include "clang/Basic/Diagnostic.h"

using namespace clang;
using namespace clang::ast_matchers;

namespace {

// ============================================================================
// MallocCallback — Invoked for each matched malloc/calloc/realloc usage
// ============================================================================
class MallocCallback : public MatchFinder::MatchCallback {
public:
    void run(const MatchFinder::MatchResult &Result) override {
        ASTContext *Context = Result.Context;
        const SourceManager &SM = Context->getSourceManager();

        // --- Determine which pattern matched ---
        const VarDecl *Var = nullptr;
        const CallExpr *MallocCall = nullptr;

        // Pattern 1: VarDecl with malloc initializer
        //   e.g., int *p = (int *)malloc(sizeof(int));
        if (auto *V = Result.Nodes.getNodeAs<VarDecl>("malloc_var")) {
            Var = V;
            MallocCall = Result.Nodes.getNodeAs<CallExpr>("malloc_call");
        }
        // Pattern 2: Separate assignment
        //   e.g., int *p; ... p = (int *)malloc(sizeof(int));
        else if (auto *V = Result.Nodes.getNodeAs<VarDecl>("assign_var")) {
            Var = V;
            MallocCall = Result.Nodes.getNodeAs<CallExpr>("assign_call");
        }

        if (!Var) return;

        // --- Get the enclosing function ---
        const DeclContext *DC = Var->getDeclContext();
        const FunctionDecl *Func = dyn_cast<FunctionDecl>(DC);
        if (!Func || !Func->hasBody()) return;

        // =================================================================
        // STEP 1: Find ALL dereferences of this variable in the function
        // Covers: *ptr, ptr[i], and ptr->member
        // =================================================================
        auto DerefMatcher = expr(anyOf(
            // *ptr
            unaryOperator(
                hasOperatorName("*"),
                hasUnaryOperand(ignoringParenImpCasts(
                    declRefExpr(to(varDecl(equalsNode(Var))))
                ))
            ),
            // ptr[i]
            arraySubscriptExpr(
                hasBase(ignoringParenImpCasts(
                    declRefExpr(to(varDecl(equalsNode(Var))))
                ))
            ),
            // ptr->member (arrow is an implicit dereference)
            memberExpr(
                isArrow(),
                hasObjectExpression(ignoringParenImpCasts(
                    declRefExpr(to(varDecl(equalsNode(Var))))
                ))
            )
        )).bind("deref");

        auto DerefMatches = match(findAll(DerefMatcher), *Func->getBody(), *Context);

        if (DerefMatches.empty()) return; // No dereferences — nothing to warn about

        // =================================================================
        // STEP 2: Find all null-guard if-statements for this variable
        // Matches any `if (...)` whose condition references our variable
        // =================================================================
        auto IfGuardMatcher = ifStmt(
            hasCondition(hasDescendant(
                declRefExpr(to(varDecl(equalsNode(Var))))
            ))
        ).bind("guard");

        auto IfMatches = match(findAll(IfGuardMatcher), *Func->getBody(), *Context);

        // =================================================================
        // STEP 3: For each dereference, check if a guard exists BEFORE it
        // This is the key improvement — ordering-aware analysis
        // =================================================================
        DiagnosticsEngine &Diag = Context->getDiagnostics();

        unsigned WarnID = Diag.getCustomDiagID(
            DiagnosticsEngine::Warning,
            "potential null pointer dereference: '%0' used without "
            "a preceding null check after allocation"
        );

        unsigned NoteID = Diag.getCustomDiagID(
            DiagnosticsEngine::Note,
            "pointer '%0' was allocated by %1() here"
        );

        // --- Build context-aware fix-it based on function return type ---
        std::string VarName = Var->getNameAsString();
        std::string ReturnStmt;
        QualType RetType = Func->getReturnType();

        if (RetType->isVoidType()) {
            ReturnStmt = "return";
        } else if (RetType->isPointerType()) {
            ReturnStmt = "return NULL";
        } else if (RetType->isIntegerType()) {
            ReturnStmt = (Func->getNameAsString() == "main") ? "return 1" : "return -1";
        } else {
            ReturnStmt = "return";
        }

        std::string FixIt = "if (" + VarName + " == NULL) " + ReturnStmt + ";\n    ";

        // --- Get the allocation function name for the note diagnostic ---
        std::string AllocFunc = "malloc";
        if (MallocCall) {
            if (const FunctionDecl *Callee = MallocCall->getDirectCallee())
                AllocFunc = Callee->getNameAsString();
        }

        // --- Check each dereference against guards ---
        for (const auto &DM : DerefMatches) {
            const Stmt *Deref = DM.getNodeAs<Stmt>("deref");
            if (!Deref) continue;

            SourceLocation DerefLoc = Deref->getBeginLoc();

            // Is there ANY null-guard that comes BEFORE this dereference?
            bool HasPriorGuard = false;
            for (const auto &GM : IfMatches) {
                const Stmt *Guard = GM.getNodeAs<Stmt>("guard");
                if (!Guard) continue;

                if (SM.isBeforeInTranslationUnit(Guard->getBeginLoc(), DerefLoc)) {
                    HasPriorGuard = true;
                    break;
                }
            }

            if (!HasPriorGuard) {
                // Emit the warning at the dereference site
                Diag.Report(DerefLoc, WarnID)
                    << VarName
                    << Deref->getSourceRange()
                    << FixItHint::CreateInsertion(DerefLoc, FixIt);

                // Emit a note pointing back to the allocation call
                if (MallocCall) {
                    Diag.Report(MallocCall->getBeginLoc(), NoteID)
                        << VarName
                        << AllocFunc;
                }

                // One warning per variable to keep output clean
                break;
            }
        }
    }
};

// ============================================================================
// MallocCheckerAction — Plugin entry point that registers AST matchers
// ============================================================================
class MallocCheckerAction : public PluginASTAction {
protected:
    std::unique_ptr<ASTConsumer> CreateASTConsumer(
        CompilerInstance &CI, llvm::StringRef) override
    {
        Finder = std::make_unique<MatchFinder>();
        Callback = std::make_unique<MallocCallback>();

        // Pattern 1: Variable declaration initialized with an alloc call
        //   int *p = malloc(sizeof(int));
        auto InitMatcher = varDecl(
            hasInitializer(ignoringParenCasts(
                callExpr(callee(functionDecl(
                    hasAnyName("malloc", "calloc", "realloc")
                ))).bind("malloc_call")
            ))
        ).bind("malloc_var");

        // Pattern 2: Separate assignment to an existing variable
        //   int *p;  p = malloc(sizeof(int));
        auto AssignMatcher = binaryOperator(
            hasOperatorName("="),
            hasLHS(declRefExpr(to(varDecl().bind("assign_var")))),
            hasRHS(ignoringParenCasts(
                callExpr(callee(functionDecl(
                    hasAnyName("malloc", "calloc", "realloc")
                ))).bind("assign_call")
            ))
        );

        Finder->addMatcher(InitMatcher, Callback.get());
        Finder->addMatcher(AssignMatcher, Callback.get());
        return Finder->newASTConsumer();
    }

    bool ParseArgs(const CompilerInstance &CI,
                   const std::vector<std::string> &args) override {
        return true;
    }

private:
    std::unique_ptr<MatchFinder> Finder;
    std::unique_ptr<MallocCallback> Callback;
};

} // anonymous namespace

// Register the plugin so Clang can load it via -Xclang -load
static FrontendPluginRegistry::Add<MallocCheckerAction>
    X("malloc-checker", "Detects unchecked malloc/calloc/realloc return values");