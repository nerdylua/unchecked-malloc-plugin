import os
import re
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
            ['clang', '-Xclang', '-ast-dump', '-fno-color-diagnostics',
             '-fsyntax-only', temp_path],
            capture_output=True, text=True, timeout=15
        )
        exec_time_ms = int((time.time() - start_time) * 1000)

        tree = parse_ast_dump(result.stdout, temp_path)
        return jsonify({'tree': tree, 'raw': result.stdout, 'time_ms': exec_time_ms})

    except subprocess.TimeoutExpired:
        return jsonify({'error': 'AST dump timed out'}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        os.unlink(temp_path)


def parse_ast_dump(raw, temp_path=''):
    lines = raw.split('\n')
    root = {'type': 'TranslationUnitDecl', 'detail': '', 'children': [], 'depth': -1, 'raw': ''}
    stack = [root]

    temp_basename = os.path.basename(temp_path) if temp_path else ''

    for line in lines:
        if not line.strip():
            continue

        depth = 0
        i = 0
        while i < len(line) and line[i] in ' |`-':
            i += 1
            depth += 1
        depth = depth // 2

        content = line[i:].strip()
        if not content:
            continue

        parts = content.split(' ', 1)
        node_type = parts[0]
        raw_detail = parts[1] if len(parts) > 1 else ''

        detail = re.sub(r'0x[0-9a-f]+\s*', '', raw_detail)
        detail = re.sub(r'<[^>]*>', '', detail).strip()
        detail = re.sub(r'\s+', ' ', detail).strip()

        if len(detail) > 100:
            detail = detail[:100] + '...'

        node = {'type': node_type, 'detail': detail, 'children': [], 'depth': depth, 'raw': raw_detail}

        while len(stack) > 1 and stack[-1]['depth'] >= depth:
            stack.pop()

        stack[-1]['children'].append(node)
        stack.append(node)

    result = root
    if root['children']:
        result = root['children'][0]

    result['children'] = [c for c in result.get('children', [])
                          if is_user_node(c, temp_basename)]

    strip_meta(result)
    return result


def is_user_node(node, temp_basename):
    raw = node.get('raw', '')

    if temp_basename and temp_basename in raw:
        return True

    if 'line:' in raw and '<' in raw:
        loc = raw[raw.index('<'):raw.index('>')+1] if '>' in raw else ''
        if '/usr/' in loc or '/lib/' in loc or '/include/' in loc:
            return False
        if temp_basename and temp_basename not in loc:
            return False

    if 'implicit' in raw:
        return False
    if '<invalid sloc>' in raw:
        return False

    return False


def strip_meta(node):
    node.pop('depth', None)
    node.pop('raw', None)
    for c in node.get('children', []):
        strip_meta(c)


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
