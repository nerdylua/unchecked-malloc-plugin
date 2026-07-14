import os
import re
import json
import time
import subprocess
import tempfile
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS

app = Flask(__name__, static_folder='.', static_url_path='')
CORS(app)

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PLUGIN_PATH = os.path.join(SCRIPT_DIR, '..', 'build', 'MallocCheckerPlugin.so')


@app.route('/')
def index():
    return send_from_directory('.', 'index.html')

@app.route('/<path:path>')
def static_files(path):
    return send_from_directory('.', path)


@app.route('/presets', methods=['GET'])
def get_presets():
    tests_dir = os.path.join(SCRIPT_DIR, '..', 'testcases')
    presets = []
    for filename in sorted(os.listdir(tests_dir)):
        if filename.endswith('.c'):
            filepath = os.path.join(tests_dir, filename)
            with open(filepath, 'r') as f:
                code = f.read()
            label = filename.replace('.c', '').replace('_', ' ').title()
            presets.append({
                'name': filename,
                'label': label,
                'code': code,
                'expectWarning': filename.startswith('tp')
            })
    return jsonify(presets)


@app.route('/analyze', methods=['POST'])
def analyze():
    code = request.json.get('code', '')
    if not code.strip():
        return jsonify({'warnings': [], 'raw': '', 'error': 'No code provided'}), 400

    fd, temp_path = tempfile.mkstemp(suffix='.c')
    try:
        with os.fdopen(fd, 'w') as f:
            f.write(code)

        start_time = time.time()
        result = subprocess.run(
            [
                'clang',
                '-Xclang', '-load', '-Xclang', PLUGIN_PATH,
                '-Xclang', '-plugin', '-Xclang', 'malloc-checker',
                '-fsyntax-only',
                '-fdiagnostics-parseable-fixits',
                temp_path
            ],
            capture_output=True,
            text=True,
            timeout=15
        )
        exec_time_ms = int((time.time() - start_time) * 1000)

        diagnostics = parse_diagnostics(result.stderr, temp_path)
        return jsonify({
            'diagnostics': diagnostics,
            'raw': result.stderr,
            'returncode': result.returncode,
            'time_ms': exec_time_ms
        })

    except subprocess.TimeoutExpired:
        return jsonify({'error': 'Analysis timed out (15s limit)'}), 500
    except FileNotFoundError:
        return jsonify({'error': 'Clang not found. Is it installed?'}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        os.unlink(temp_path)


@app.route('/ast', methods=['POST'])
def ast_dump():
    code = request.json.get('code', '')
    if not code.strip():
        return jsonify({'error': 'No code provided'}), 400

    fd, temp_path = tempfile.mkstemp(suffix='.c')
    try:
        with os.fdopen(fd, 'w') as f:
            f.write(code)

        start_time = time.time()
        result = subprocess.run(
            ['clang', '-Xclang', '-ast-dump=json', '-fno-color-diagnostics',
             '-fsyntax-only', temp_path],
            capture_output=True, text=True, timeout=15
        )
        exec_time_ms = int((time.time() - start_time) * 1000)

        try:
            raw_tree = json.loads(result.stdout)
        except json.JSONDecodeError:
            return jsonify({
                'error': 'Clang did not return a JSON AST',
                'raw': result.stderr,
                'time_ms': exec_time_ms
            }), 500

        tree = parse_ast_json(raw_tree, temp_path, code)
        return jsonify({'tree': tree, 'raw': result.stderr, 'time_ms': exec_time_ms})

    except subprocess.TimeoutExpired:
        return jsonify({'error': 'AST dump timed out'}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        os.unlink(temp_path)


KIND_LABELS = {
    'TranslationUnitDecl': 'Source file',
    'FunctionDecl': 'Function declaration',
    'ParmVarDecl': 'Parameter declaration',
    'VarDecl': 'Variable declaration',
    'FieldDecl': 'Field declaration',
    'RecordDecl': 'Record declaration',
    'TypedefDecl': 'Type alias',
    'CompoundStmt': 'Block',
    'DeclStmt': 'Declaration statement',
    'IfStmt': 'If statement',
    'ForStmt': 'For loop',
    'WhileStmt': 'While loop',
    'ReturnStmt': 'Return statement',
    'CallExpr': 'Function call',
    'BinaryOperator': 'Binary operation',
    'UnaryOperator': 'Unary operation',
    'DeclRefExpr': 'Variable reference',
    'MemberExpr': 'Member access',
    'ArraySubscriptExpr': 'Array access',
    'IntegerLiteral': 'Integer literal',
    'FloatingLiteral': 'Floating-point literal',
    'StringLiteral': 'String literal',
    'CharacterLiteral': 'Character literal',
    'ImplicitCastExpr': 'Implicit conversion',
    'CStyleCastExpr': 'C-style cast',
}


def ast_category(kind):
    if kind.endswith('Decl'):
        return 'decl'
    if kind.endswith('Stmt'):
        return 'stmt'
    if kind.endswith(('Expr', 'Literal', 'Operator')):
        return 'expr'
    if kind.endswith('Type') or 'Cast' in kind:
        return 'type'
    return 'other'


def readable_kind(kind):
    if kind in KIND_LABELS:
        return KIND_LABELS[kind]
    words = re.sub(r'(?<!^)([A-Z])', r' \1', kind).replace('_', ' ')
    for suffix in (' Decl', ' Expr', ' Stmt'):
        if words.endswith(suffix):
            words = words[:-len(suffix)]
            break
    return words.strip().capitalize()


def node_location(raw, inherited_file=''):
    def resolve(location):
        location = location or {}
        # Macro-generated nodes identify both the spelling site and the source
        # expansion. Prefer the expansion so source code remains visible.
        return location.get('expansionLoc') or location.get('spellingLoc') or location

    loc = resolve(raw.get('loc'))
    begin = resolve((raw.get('range') or {}).get('begin'))
    end = resolve((raw.get('range') or {}).get('end'))
    source_file = loc.get('file') or begin.get('file') or end.get('file') or inherited_file
    line = loc.get('line') or begin.get('line')
    column = loc.get('col') or begin.get('col')
    end_line = end.get('line') or line
    end_column = end.get('col') or column
    return {
        'file': source_file,
        'line': line,
        'column': column,
        'endLine': end_line,
        'endColumn': end_column,
    }


def is_submitted_file(source_file, temp_path):
    if not source_file:
        return False
    if os.path.basename(source_file) == os.path.basename(temp_path):
        return True
    try:
        return os.path.samefile(source_file, temp_path)
    except (FileNotFoundError, OSError):
        return os.path.abspath(source_file) == os.path.abspath(temp_path)


def node_summary(raw):
    parts = []
    if raw.get('name'):
        parts.append(raw['name'])
    if raw.get('opcode'):
        parts.append('operator ' + raw['opcode'])
    if raw.get('value') is not None:
        parts.append('value ' + str(raw['value']))
    node_type = raw.get('type') or {}
    if node_type.get('qualType'):
        parts.append(node_type['qualType'])
    reference = raw.get('referencedDecl') or {}
    if reference.get('name'):
        parts.append('ref ' + reference['name'])
    return ' · '.join(parts)


def node_metadata(raw):
    return {
        key: value for key, value in raw.items()
        if key not in {'id', 'kind', 'loc', 'range', 'inner'}
    }


def parse_ast_json(raw_tree, temp_path='', source_code=''):
    """Normalize Clang's structured AST while excluding included-header roots."""
    source_lines = source_code.splitlines()

    def convert(raw, inherited_file='', is_root=False):
        location = node_location(raw, inherited_file)
        source_file = location['file'] or inherited_file
        kind = raw.get('kind', 'Unknown')
        children = []
        for child in raw.get('inner', []):
            normalized = convert(child, source_file)
            if normalized:
                children.append(normalized)

        belongs_to_source = is_root or is_submitted_file(source_file, temp_path)
        if not belongs_to_source:
            return None

        line = location.get('line')
        excerpt = ''
        if isinstance(line, int) and 1 <= line <= len(source_lines):
            excerpt = source_lines[line - 1].strip()

        return {
            'id': raw.get('id', f'{kind}-{line or 0}-{len(children)}'),
            'kind': kind,
            'label': readable_kind(kind),
            'category': ast_category(kind),
            'summary': node_summary(raw),
            'location': location,
            'sourceExcerpt': excerpt,
            'isImplicit': bool(raw.get('isImplicit')),
            'metadata': node_metadata(raw),
            'children': children,
        }

    return convert(raw_tree, is_root=True)


def parse_diagnostics(stderr, temp_path):
    diagnostics = []
    fixit_pattern = re.compile(r'fix-it:"[^"]*":\{(\d+):(\d+)-(\d+):(\d+)\}:"(.*)"')
    diag_pattern = re.compile(r'[^:]+:(\d+):(\d+):\s+(warning|note|error):\s+(.*)')

    lines = stderr.split('\n')
    i = 0
    while i < len(lines):
        line = lines[i]
        m = diag_pattern.match(line)
        if m:
            diag = {
                'line': int(m.group(1)),
                'col': int(m.group(2)),
                'type': m.group(3),
                'message': m.group(4),
                'fixit': None
            }
            j = i + 1
            while j < len(lines):
                fm = fixit_pattern.match(lines[j])
                if fm:
                    fixit_text = fm.group(5).encode().decode('unicode_escape')
                    diag['fixit'] = {
                        'startLine': int(fm.group(1)),
                        'startCol': int(fm.group(2)),
                        'endLine': int(fm.group(3)),
                        'endCol': int(fm.group(4)),
                        'text': fixit_text
                    }
                    break
                elif diag_pattern.match(lines[j]) or lines[j].startswith('fix-it:'):
                    break
                j += 1
            diagnostics.append(diag)
        i += 1

    return diagnostics


if __name__ == '__main__':
    if not os.path.exists(PLUGIN_PATH):
        print(f"Plugin not found at: {PLUGIN_PATH}")
        print("Build it first: cd build && cmake .. && make")
    else:
        print(f"Plugin found: {PLUGIN_PATH}")

    print(f"Starting MallocGuard web server at http://localhost:5000")
    app.run(debug=True, host='0.0.0.0', port=5000)
