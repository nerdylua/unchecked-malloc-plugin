#include "clang/ASTMatchers/ASTMatchFinder.h"
#include "clang/ASTMatchers/ASTMatchers.h"
#include "clang/Frontend/CompilerInstance.h"
#include "clang/Frontend/FrontendPluginRegistry.h"
#include "clang/Basic/Diagnostic.h"

using namespace clang;
using namespace clang::ast_matchers;

namespace {

class MallocCallback : public MatchFinder::MatchCallback {
public:
    virtual void run(const MatchFinder::MatchResult &Result) override {
        ASTContext *Context = Result.Context;
        const VarDecl *Var = Result.Nodes.getNodeAs<VarDecl>("malloc_var");

        if (!Var) return;

        // Get the function this variable is inside
        const DeclContext *DC = Var->getDeclContext();
        const FunctionDecl *Func = dyn_cast<FunctionDecl>(DC);
        if (!Func || !Func->hasBody()) return;

        // 1. DEREFERENCE CHECK: Does this variable get dereferenced (*ptr or ptr[0])?
        auto DerefMatcher = expr(anyOf(
            unaryOperator(hasOperatorName("*"), hasUnaryOperand(ignoringParenImpCasts(declRefExpr(to(varDecl(equalsNode(Var))))))),
            arraySubscriptExpr(hasBase(ignoringParenImpCasts(declRefExpr(to(varDecl(equalsNode(Var)))))))
        )).bind("deref");

        auto DerefMatches = match(findAll(DerefMatcher), *Func->getBody(), *Context);

        // 2. NULL GUARD CHECK: Is this variable checked in an if statement?
        auto IfGuardMatcher = ifStmt(hasCondition(hasDescendant(declRefExpr(to(varDecl(equalsNode(Var)))))));
        auto IfMatches = match(findAll(IfGuardMatcher), *Func->getBody(), *Context);

        // 3. THE VERDICT: If there is a dereference, but NO if-guard, emit a warning!
        if (!DerefMatches.empty() && IfMatches.empty()) {
            const Stmt *BadDeref = DerefMatches[0].getNodeAs<Stmt>("deref");

            // --- DIAGNOSTICS & FIX-IT ---
            DiagnosticsEngine &DiagEngine = Context->getDiagnostics();
            
            // Create a custom compiler warning
            unsigned WarningID = DiagEngine.getCustomDiagID(
                DiagnosticsEngine::Warning, 
                "Unchecked malloc return value! Potential null pointer dereference."
            );

            // Create a fix-it string that suggests adding a NULL check and return
            std::string VarName = Var->getNameAsString();
            std::string FixItStr = "if (" + VarName + " == NULL) return; \n    ";

            // Emit the warning and attach the Fix-It hint exactly where the bad dereference starts
            DiagEngine.Report(BadDeref->getBeginLoc(), WarningID) 
                << BadDeref->getSourceRange()
                << FixItHint::CreateInsertion(BadDeref->getBeginLoc(), FixItStr);
        }
    }
};

class MallocCheckerAction : public PluginASTAction {
protected:
    std::unique_ptr<ASTConsumer> CreateASTConsumer(CompilerInstance &CI, llvm::StringRef) override {
        Finder = std::make_unique<MatchFinder>();
        Callback = std::make_unique<MallocCallback>();

        // Match variable declarations initialized with malloc
        DeclarationMatcher MallocVarMatcher = 
            varDecl(hasInitializer(ignoringParenCasts(
                callExpr(callee(functionDecl(anyOf(
    hasName("malloc"), 
    hasName("calloc"), 
    hasName("realloc")
))))
            ))).bind("malloc_var");

        Finder->addMatcher(MallocVarMatcher, Callback.get());
        return Finder->newASTConsumer();
    }

    bool ParseArgs(const CompilerInstance &CI, const std::vector<std::string> &args) override {
        return true;
    }

private:
    std::unique_ptr<MatchFinder> Finder;
    std::unique_ptr<MallocCallback> Callback;
};

} // namespace

static FrontendPluginRegistry::Add<MallocCheckerAction> 
X("malloc-checker", "Checks for unchecked malloc returns");