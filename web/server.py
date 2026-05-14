"""
MallocGuard — Web Backend
Flask server that accepts C code, runs the Clang plugin, and returns
structured analysis results as JSON.
"""

import os
import re
import subprocess
import tempfile
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS

app = Flask(__name__, static_folder='.', static_url_path='')
CORS(app)

# Path to the compiled plugin
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PLUGIN_PATH = os.path.join(SCRIPT_DIR, '..', 'build', 'MallocCheckerPlugin.so')

# ── Serve Frontend ──────────────────────────────────────────────────────────

@app.route('/')
def index():
    return send_from_directory('.', 'index.html')

@app.route('/<path:path>')
def static_files(path):
    return send_from_directory('.', path)

# ── API: Load preset test files ─────────────────────────────────────────────

@app.route('/presets', methods=['GET'])
def get_presets():
    tests_dir = os.path.join(SCRIPT_DIR, '..', 'tests')
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

# ── API: Analyze C code ─────────────────────────────────────────────────────

@app.route('/analyze', methods=['POST'])
def analyze():
    code = request.json.get('code', '')
    if not code.strip():
        return jsonify({'warnings': [], 'raw': '', 'error': 'No code provided'}), 400

    # Write code to a temporary file
    fd, temp_path = tempfile.mkstemp(suffix='.c')
    try:
        with os.fdopen(fd, 'w') as f:
            f.write(code)

        # Run Clang with our plugin
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

        diagnostics = parse_diagnostics(result.stderr, temp_path)
        return jsonify({
            'diagnostics': diagnostics,
            'raw': result.stderr,
            'returncode': result.returncode
        })

    except subprocess.TimeoutExpired:
        return jsonify({'error': 'Analysis timed out (15s limit)'}), 500
    except FileNotFoundError:
        return jsonify({'error': 'Clang not found. Is it installed?'}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        os.unlink(temp_path)

# ── Diagnostic Parser ───────────────────────────────────────────────────────

def parse_diagnostics(stderr, temp_path):
    """Parse Clang diagnostic output into structured JSON."""
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
            # Look ahead for fix-it on subsequent lines
            j = i + 1
            while j < len(lines):
                fm = fixit_pattern.match(lines[j])
                if fm:
                    # Unescape the fix-it string
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

# ── Entry Point ─────────────────────────────────────────────────────────────

if __name__ == '__main__':
    if not os.path.exists(PLUGIN_PATH):
        print(f"⚠  Plugin not found at: {PLUGIN_PATH}")
        print("   Build it first: cd build && cmake .. && make")
    else:
        print(f"✓  Plugin found: {PLUGIN_PATH}")

    print(f"🚀 Starting MallocGuard web server at http://localhost:5000")
    app.run(debug=True, host='0.0.0.0', port=5000)
