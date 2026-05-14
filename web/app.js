// ============================================================================
// MallocGuard — Frontend Application Logic
// ============================================================================

const API_BASE = window.location.origin;
const editor = document.getElementById('code-editor');
const lineNumbers = document.getElementById('line-numbers');
const diagnosticsList = document.getElementById('diagnostics-list');
const emptyState = document.getElementById('empty-state');
const analyzeBtn = document.getElementById('analyze-btn');
const presetSelect = document.getElementById('preset-select');
const lineCountBadge = document.getElementById('line-count');
const warningCountBadge = document.getElementById('warning-count');
const statusText = document.getElementById('status-text');

let presets = [];

// ── Initialize ─────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    updateLineNumbers();
    loadPresets();

    // Keyboard shortcut: Ctrl+Enter to analyze
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            runAnalysis();
        }
    });

    // Tab key inserts spaces in editor
    editor.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') {
            e.preventDefault();
            const start = editor.selectionStart;
            const end = editor.selectionEnd;
            editor.value = editor.value.substring(0, start) + '    ' + editor.value.substring(end);
            editor.selectionStart = editor.selectionEnd = start + 4;
            updateLineNumbers();
        }
    });

    editor.addEventListener('input', updateLineNumbers);
    editor.addEventListener('scroll', syncScroll);

    presetSelect.addEventListener('change', () => {
        const selected = presets.find(p => p.name === presetSelect.value);
        if (selected) {
            editor.value = selected.code;
            updateLineNumbers();
            clearResults();
        }
    });
});

// ── Line Numbers ───────────────────────────────────────────────────────────

function updateLineNumbers(warningLines = []) {
    const lines = editor.value.split('\n');
    const count = lines.length;
    lineCountBadge.textContent = `${count} line${count !== 1 ? 's' : ''}`;

    let html = '';
    for (let i = 1; i <= count; i++) {
        const isWarning = warningLines.includes(i);
        html += `<div class="${isWarning ? 'warning-line' : ''}">${i}</div>`;
    }
    lineNumbers.innerHTML = html;
}

function syncScroll() {
    lineNumbers.scrollTop = editor.scrollTop;
}

// ── Presets ─────────────────────────────────────────────────────────────────

async function loadPresets() {
    try {
        const res = await fetch(`${API_BASE}/presets`);
        presets = await res.json();
        presets.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.name;
            opt.textContent = `${p.expectWarning ? '⚠' : '✓'} ${p.label}`;
            presetSelect.appendChild(opt);
        });
    } catch (e) {
        console.warn('Could not load presets:', e);
    }
}

// ── Analysis ───────────────────────────────────────────────────────────────

async function runAnalysis() {
    const code = editor.value.trim();
    if (!code) {
        setStatus('No code to analyze', 'error');
        return;
    }

    // UI: loading state
    analyzeBtn.classList.add('loading');
    analyzeBtn.querySelector('.btn-text').textContent = 'Analyzing';
    setStatus('Analyzing...', 'analyzing');
    clearResults();

    try {
        const res = await fetch(`${API_BASE}/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code })
        });

        const data = await res.json();

        if (data.error) {
            showError(data.error);
            setStatus(`Error: ${data.error}`, 'error');
            return;
        }

        renderResults(data);

        const warnCount = data.diagnostics.filter(d => d.type === 'warning').length;
        if (warnCount > 0) {
            setStatus(`Found ${warnCount} warning${warnCount > 1 ? 's' : ''}`, 'error');
        } else {
            setStatus('Analysis complete — no issues found', 'success');
        }
    } catch (e) {
        showError('Could not connect to the server. Is server.py running?');
        setStatus('Connection failed', 'error');
    } finally {
        analyzeBtn.classList.remove('loading');
        analyzeBtn.querySelector('.btn-text').textContent = 'Analyze';
    }
}

// ── Render Results ─────────────────────────────────────────────────────────

function renderResults(data) {
    const { diagnostics, raw } = data;
    diagnosticsList.innerHTML = '';
    emptyState.style.display = 'none';

    const warnings = diagnostics.filter(d => d.type === 'warning');
    const warningLines = warnings.map(d => d.line);

    // Update line numbers with warning indicators
    updateLineNumbers(warningLines);

    // Update badge
    if (warnings.length > 0) {
        warningCountBadge.textContent = `${warnings.length} warning${warnings.length > 1 ? 's' : ''}`;
        warningCountBadge.className = 'panel-badge has-warnings';
    } else {
        warningCountBadge.textContent = 'Clean ✓';
        warningCountBadge.className = 'panel-badge clean';
    }

    // Summary card
    const summary = document.createElement('div');
    if (warnings.length === 0) {
        summary.className = 'summary-card clean';
        summary.innerHTML = `
            <div class="summary-icon">✅</div>
            <div class="summary-text">No issues found — code looks safe!</div>
        `;
    } else {
        summary.className = 'summary-card has-issues';
        summary.innerHTML = `
            <div class="summary-icon">⚠️</div>
            <div class="summary-text">${warnings.length} potential null pointer dereference${warnings.length > 1 ? 's' : ''} detected</div>
        `;
    }
    diagnosticsList.appendChild(summary);

    // Diagnostic cards
    diagnostics.forEach((diag, idx) => {
        const card = createDiagCard(diag, idx);
        diagnosticsList.appendChild(card);
    });

    // Raw output toggle
    if (raw && raw.trim()) {
        const rawSection = document.createElement('details');
        rawSection.className = 'raw-toggle';
        rawSection.innerHTML = `
            <summary>📋 Raw Clang Output</summary>
            <div class="raw-output">${escapeHtml(raw)}</div>
        `;
        diagnosticsList.appendChild(rawSection);
    }
}

function createDiagCard(diag, index) {
    const card = document.createElement('div');
    card.className = `diag-card ${diag.type}`;
    card.style.animationDelay = `${index * 0.08}s`;

    const icons = { warning: '⚠️', note: '📝', error: '❌' };

    let html = `
        <div class="diag-header">
            <span class="diag-icon">${icons[diag.type] || '❓'}</span>
            <span class="diag-type">${diag.type}</span>
            <span class="diag-location">Line ${diag.line}:${diag.col}</span>
        </div>
        <div class="diag-message">${escapeHtml(diag.message)}</div>
    `;

    if (diag.fixit && diag.fixit.text) {
        const fixitDisplay = diag.fixit.text.replace(/\\n/g, '\n').trim();
        html += `
            <div class="diag-fixit">
                <span class="fixit-label">💡 Fix:</span>
                <code class="fixit-code">${escapeHtml(fixitDisplay)}</code>
                <button class="fixit-apply-btn" onclick="applyFixit(${diag.fixit.startLine}, ${diag.fixit.startCol}, ${diag.fixit.endLine}, ${diag.fixit.endCol}, '${escapeJs(diag.fixit.text)}')">
                    Apply Fix
                </button>
            </div>
        `;
    }

    card.innerHTML = html;
    return card;
}

// ── Apply Fix-It ───────────────────────────────────────────────────────────

function applyFixit(startLine, startCol, endLine, endCol, text) {
    const lines = editor.value.split('\n');
    const fixText = text.replace(/\\n/g, '\n');

    // Convert line:col to string index
    // Fix-it is an insertion (start == end), so insert at that position
    if (startLine >= 1 && startLine <= lines.length) {
        const lineIdx = startLine - 1;
        const colIdx = startCol - 1;
        const line = lines[lineIdx];

        // Insert the fix-it text at the specified column
        const before = line.substring(0, colIdx);
        const after = line.substring(colIdx);
        lines[lineIdx] = before + fixText + after;

        editor.value = lines.join('\n');
        updateLineNumbers();
        setStatus('Fix applied! Re-analyze to verify.', 'success');
    }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function clearResults() {
    diagnosticsList.innerHTML = '';
    emptyState.style.display = '';
    warningCountBadge.textContent = 'Ready';
    warningCountBadge.className = 'panel-badge';
    updateLineNumbers();
}

function showError(msg) {
    diagnosticsList.innerHTML = '';
    emptyState.style.display = 'none';
    const card = document.createElement('div');
    card.className = 'diag-card error';
    card.innerHTML = `
        <div class="diag-header">
            <span class="diag-icon">❌</span>
            <span class="diag-type">Error</span>
        </div>
        <div class="diag-message">${escapeHtml(msg)}</div>
    `;
    diagnosticsList.appendChild(card);
}

function setStatus(text, className) {
    statusText.textContent = text;
    statusText.className = className || '';
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function escapeJs(str) {
    return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
}
