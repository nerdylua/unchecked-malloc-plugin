const API_BASE = window.location.origin;
const editor = document.getElementById('code-editor');
const lineNumbers = document.getElementById('line-numbers');
const diagnosticsList = document.getElementById('diagnostics-list');
const emptyState = document.getElementById('empty-state');
const astEmpty = document.getElementById('ast-empty');
const astViews = document.getElementById('ast-views');
const astTree = document.getElementById('ast-tree');
const astSvg = document.getElementById('ast-svg');
const analyzeBtn = document.getElementById('analyze-btn');
const presetSelect = document.getElementById('preset-select');
const lineCountBadge = document.getElementById('line-count');
const warningCountBadge = document.getElementById('warning-count');
const statusText = document.getElementById('status-text');
const statusStats = document.getElementById('status-stats');

let presets = [];
let currentAstData = null;

document.addEventListener('DOMContentLoaded', () => {
    updateLineNumbers();
    loadPresets();

    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            runAnalysis();
        }
    });

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

    setupSvgPanZoom();
});

function switchTab(tab) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.querySelector(`.tab[data-tab="${tab}"]`).classList.add('active');
    document.getElementById(tab === 'results' ? 'results-content' : 'ast-content').classList.add('active');
}

function switchAstView(view) {
    document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.ast-view').forEach(v => v.classList.remove('active'));
    document.querySelector(`.view-btn[data-view="${view}"]`).classList.add('active');
    document.getElementById(view === 'graph' ? 'ast-graph-view' : 'ast-list-view').classList.add('active');
}

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

async function loadPresets() {
    try {
        const res = await fetch(`${API_BASE}/presets`);
        presets = await res.json();
        presets.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.name;
            const marker = p.expectWarning ? '[TP]' : '[TN]';
            opt.textContent = `${marker} ${p.label}`;
            presetSelect.appendChild(opt);
        });
    } catch (e) {
        console.warn('Could not load presets:', e);
    }
}

async function runAnalysis() {
    const code = editor.value.trim();
    if (!code) {
        setStatus('No code to analyze', 'error');
        return;
    }

    analyzeBtn.classList.add('loading');
    analyzeBtn.querySelector('.btn-text').textContent = 'Analyzing';
    setStatus('Analyzing...', 'analyzing');
    clearResults();

    try {
        const [analyzeRes, astRes] = await Promise.all([
            fetch(`${API_BASE}/analyze`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code })
            }),
            fetch(`${API_BASE}/ast`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code })
            })
        ]);

        const data = await analyzeRes.json();
        const astData = await astRes.json();

        if (data.error) {
            showError(data.error);
            setStatus(`Error: ${data.error}`, 'error');
            return;
        }

        renderResults(data);
        renderAstTree(astData);

        const warnCount = data.diagnostics.filter(d => d.type === 'warning').length;
        if (warnCount > 0) {
            setStatus(`Found ${warnCount} warning${warnCount > 1 ? 's' : ''}`, 'error');
        } else {
            setStatus('Analysis complete - no issues found', 'success');
        }

        if (statusStats) {
            const analyzeTime = data.time_ms || 0;
            const astTime = astData.time_ms || 0;
            statusStats.textContent = `Plugin: ${analyzeTime}ms | AST: ${astTime}ms`;
        }
    } catch (e) {
        showError('Could not connect to the server. Is server.py running?');
        setStatus('Connection failed', 'error');
    } finally {
        analyzeBtn.classList.remove('loading');
        analyzeBtn.querySelector('.btn-text').textContent = 'Analyze';
    }
}

function renderResults(data) {
    const { diagnostics, raw } = data;
    diagnosticsList.innerHTML = '';
    emptyState.style.display = 'none';

    const warnings = diagnostics.filter(d => d.type === 'warning');
    const warningLines = warnings.map(d => d.line);
    updateLineNumbers(warningLines);

    if (warnings.length > 0) {
        warningCountBadge.textContent = `${warnings.length} warning${warnings.length > 1 ? 's' : ''}`;
        warningCountBadge.className = 'panel-badge has-warnings';
    } else {
        warningCountBadge.textContent = 'Clean';
        warningCountBadge.className = 'panel-badge clean';
    }

    const summary = document.createElement('div');
    if (warnings.length === 0) {
        summary.className = 'summary-card clean';
        summary.innerHTML = `
            <div class="summary-icon">PASS</div>
            <div class="summary-text">No issues found - code looks safe!</div>
        `;
    } else {
        summary.className = 'summary-card has-issues';
        summary.innerHTML = `
            <div class="summary-icon">!</div>
            <div class="summary-text">${warnings.length} potential null pointer dereference${warnings.length > 1 ? 's' : ''} detected</div>
        `;
    }
    diagnosticsList.appendChild(summary);

    diagnostics.forEach((diag, idx) => {
        const card = createDiagCard(diag, idx);
        diagnosticsList.appendChild(card);
    });

    if (raw && raw.trim()) {
        const rawSection = document.createElement('details');
        rawSection.className = 'raw-toggle';
        rawSection.innerHTML = `
            <summary>Raw Clang Output</summary>
            <div class="raw-output">${escapeHtml(raw)}</div>
        `;
        diagnosticsList.appendChild(rawSection);
    }
}

function createDiagCard(diag, index) {
    const card = document.createElement('div');
    card.className = `diag-card ${diag.type}`;
    card.style.animationDelay = `${index * 0.08}s`;

    const icons = { warning: 'W', note: 'N', error: 'E' };

    let html = `
        <div class="diag-header">
            <span class="diag-icon">${icons[diag.type] || '?'}</span>
            <span class="diag-type">${diag.type}</span>
            <span class="diag-location">Line ${diag.line}:${diag.col}</span>
        </div>
        <div class="diag-message">${escapeHtml(diag.message)}</div>
    `;

    if (diag.fixit && diag.fixit.text) {
        const fixitDisplay = diag.fixit.text.replace(/\\n/g, '\n').trim();
        html += `
            <div class="diag-fixit">
                <span class="fixit-label">Fix:</span>
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

// --- AST rendering ---

function renderAstTree(data) {
    astTree.innerHTML = '';
    astSvg.innerHTML = '';

    if (data.error || !data.tree) {
        astEmpty.style.display = '';
        astViews.style.display = 'none';
        return;
    }

    const filtered = filterBuiltins(data.tree);
    if (!filtered || !filtered.children || filtered.children.length === 0) {
        astEmpty.style.display = '';
        astViews.style.display = 'none';
        return;
    }

    astEmpty.style.display = 'none';
    astViews.style.display = 'flex';

    currentAstData = filtered;
    astTree.appendChild(buildListNode(filtered, true));
    renderSvgTree(filtered);
}

function filterBuiltins(node) {
    if (!node) return null;

    const filtered = { type: node.type, detail: node.detail, children: [] };

    if (node.children) {
        for (const child of node.children) {
            if (child.type === 'TypedefDecl' && child.detail && child.detail.includes('implicit')) continue;
            if (child.type === 'RecordDecl' && child.detail && child.detail.includes('implicit')) continue;
            if (child.detail && child.detail.includes('__builtin')) continue;
            const fc = filterBuiltins(child);
            if (fc) filtered.children.push(fc);
        }
    }

    return filtered;
}

function getNodeCategory(type) {
    if (type.endsWith('Decl')) return 'decl';
    if (type.endsWith('Stmt')) return 'stmt';
    if (type.endsWith('Expr') || type.endsWith('Literal') || type.endsWith('Operator')) return 'expr';
    if (type.endsWith('Type') || type.includes('Cast')) return 'type';
    return 'other';
}

const HIGHLIGHT_TYPES = ['CallExpr', 'VarDecl', 'UnaryOperator', 'ArraySubscriptExpr', 'MemberExpr', 'IfStmt'];

const CATEGORY_COLORS = {
    decl: { fill: '#fdf0ec', stroke: '#cc785c', text: '#9b5b45' },
    stmt: { fill: '#fdf6e3', stroke: '#d4a017', text: '#9b6f08' },
    expr: { fill: '#eef8ef', stroke: '#5db872', text: '#2f8b45' },
    type: { fill: '#edf7f4', stroke: '#5db8a6', text: '#2b7d70' },
    other: { fill: '#f5f0e8', stroke: '#ccc5b9', text: '#6c6a64' }
};

const HIGHLIGHT_COLORS = { fill: '#faece8', stroke: '#c64545', text: '#a93434' };

// --- List view (indented tree) ---

function buildListNode(node, isRoot) {
    const el = document.createElement('div');
    el.className = `ast-node${isRoot ? ' ast-node-root' : ''}`;

    const hasChildren = node.children && node.children.length > 0;
    const category = getNodeCategory(node.type);
    const isHighlight = HIGHLIGHT_TYPES.includes(node.type);

    const header = document.createElement('div');
    header.className = 'ast-node-header';

    const toggle = document.createElement('span');
    toggle.className = `ast-toggle${hasChildren ? '' : ' leaf'}`;
    toggle.textContent = hasChildren ? '\u25BC' : '';

    const typeSpan = document.createElement('span');
    typeSpan.className = `ast-type ${category}${isHighlight ? ' highlight' : ''}`;
    typeSpan.textContent = node.type;

    const detailSpan = document.createElement('span');
    detailSpan.className = 'ast-detail';
    detailSpan.innerHTML = formatDetail(node.detail);

    header.appendChild(toggle);
    header.appendChild(typeSpan);
    header.appendChild(detailSpan);
    el.appendChild(header);

    if (hasChildren) {
        const childContainer = document.createElement('div');
        childContainer.className = 'ast-children';

        node.children.forEach(child => {
            childContainer.appendChild(buildListNode(child, false));
        });

        el.appendChild(childContainer);

        toggle.addEventListener('click', () => {
            const collapsed = childContainer.classList.toggle('collapsed');
            toggle.textContent = collapsed ? '\u25B6' : '\u25BC';
        });
    }

    return el;
}

function formatDetail(detail) {
    if (!detail) return '';
    return escapeHtml(detail)
        .replace(/'([^']+)'/g, '\'<span class="ast-name">$1</span>\'')
        .replace(/\b(malloc|calloc|realloc)\b/g, '<span class="ast-name">$1</span>');
}

// --- SVG graph view ---

const NODE_W = 110;
const NODE_H = 32;
const H_GAP = 8;
const V_GAP = 40;
const PADDING = 30;
const MAX_DEPTH = 5;

function renderSvgTree(tree) {
    astSvg.innerHTML = '';

    const trimmed = trimForGraph(tree, 0);
    const laid = layoutTree(trimmed, 0);
    const totalW = laid.totalW + PADDING * 2;
    const totalH = laid.totalH + PADDING * 2;

    astSvg.removeAttribute('viewBox');
    astSvg.setAttribute('width', totalW);
    astSvg.setAttribute('height', totalH);
    astSvg.style.width = totalW + 'px';
    astSvg.style.height = totalH + 'px';

    const g = svgEl('g', { transform: `translate(${PADDING}, ${PADDING})` });

    drawEdges(g, laid);
    drawNodes(g, laid);

    astSvg.appendChild(g);

    requestAnimationFrame(() => resetPanZoom(totalW, totalH));
}

function trimForGraph(node, depth) {
    if (depth >= MAX_DEPTH) {
        const childCount = (node.children && node.children.length) || 0;
        return {
            type: node.type,
            detail: childCount > 0 ? `+${childCount} more` : (node.detail || ''),
            children: []
        };
    }

    return {
        type: node.type,
        detail: node.detail || '',
        children: (node.children || []).map(c => trimForGraph(c, depth + 1))
    };
}

function layoutTree(node, depth) {
    const hasChildren = node.children && node.children.length > 0;

    if (!hasChildren) {
        return {
            type: node.type,
            detail: node.detail || '',
            x: 0,
            y: depth * (NODE_H + V_GAP),
            w: NODE_W,
            totalW: NODE_W,
            totalH: depth * (NODE_H + V_GAP) + NODE_H,
            children: []
        };
    }

    const kids = node.children.map(c => layoutTree(c, depth + 1));
    const childrenWidth = kids.reduce((sum, k) => sum + k.totalW, 0) + (kids.length - 1) * H_GAP;
    const totalW = Math.max(NODE_W, childrenWidth);

    let cx = (totalW - childrenWidth) / 2;
    for (const kid of kids) {
        kid.x += cx;
        shiftX(kid, cx);
        cx += kid.totalW + H_GAP;
    }

    const maxChildH = Math.max(...kids.map(k => k.totalH));

    return {
        type: node.type,
        detail: node.detail || '',
        x: (totalW - NODE_W) / 2,
        y: depth * (NODE_H + V_GAP),
        w: NODE_W,
        totalW,
        totalH: Math.max(maxChildH, depth * (NODE_H + V_GAP) + NODE_H),
        children: kids
    };
}

function shiftX(node, dx) {
    if (!node.children) return;
    for (const kid of node.children) {
        kid.x += dx;
        shiftX(kid, dx);
    }
}

function drawEdges(parent, node) {
    if (!node.children) return;

    const x1 = node.x + NODE_W / 2;
    const y1 = node.y + NODE_H;

    for (const kid of node.children) {
        const x2 = kid.x + NODE_W / 2;
        const y2 = kid.y;
        const midY = (y1 + y2) / 2;

        const path = svgEl('path', {
            d: `M${x1},${y1} C${x1},${midY} ${x2},${midY} ${x2},${y2}`,
            fill: 'none',
            stroke: '#ccc5b9',
            'stroke-width': 1.5,
            opacity: 0.6
        });
        parent.appendChild(path);

        drawEdges(parent, kid);
    }
}

function drawNodes(parent, node) {
    const category = getNodeCategory(node.type);
    const isHighlight = HIGHLIGHT_TYPES.includes(node.type);
    const colors = isHighlight ? HIGHLIGHT_COLORS : CATEGORY_COLORS[category];

    const rect = svgEl('rect', {
        x: node.x,
        y: node.y,
        width: NODE_W,
        height: NODE_H,
        rx: 7,
        ry: 7,
        fill: colors.fill,
        stroke: colors.stroke,
        'stroke-width': isHighlight ? 2 : 1.2
    });
    parent.appendChild(rect);

    const label = node.type.length > 14 ? node.type.substring(0, 12) + '..' : node.type;
    const text = svgEl('text', {
        x: node.x + NODE_W / 2,
        y: node.y + (node.detail ? 13 : 19),
        'text-anchor': 'middle',
        fill: colors.text,
        'font-family': '"JetBrains Mono", monospace',
        'font-size': 10,
        'font-weight': 600
    });
    text.textContent = label;
    parent.appendChild(text);

    if (node.detail) {
        let sub = node.detail.replace(/'/g, '');
        if (sub.length > 16) sub = sub.substring(0, 14) + '..';
        const subText = svgEl('text', {
            x: node.x + NODE_W / 2,
            y: node.y + 26,
            'text-anchor': 'middle',
            fill: '#8e8b82',
            'font-family': '"JetBrains Mono", monospace',
            'font-size': 8
        });
        subText.textContent = sub;
        parent.appendChild(subText);
    }

    if (node.children) {
        for (const kid of node.children) {
            drawNodes(parent, kid);
        }
    }
}

function svgEl(tag, attrs) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs || {})) {
        el.setAttribute(k, v);
    }
    return el;
}

// --- Pan & zoom for the SVG ---

let pan = { x: 0, y: 0 };
let zoom = 1;
let dragging = false;
let dragStart = { x: 0, y: 0 };

function setupSvgPanZoom() {
    const container = document.getElementById('ast-graph-view');
    if (!container) return;

    container.addEventListener('mousedown', (e) => {
        dragging = true;
        dragStart = { x: e.clientX - pan.x, y: e.clientY - pan.y };
        container.style.cursor = 'grabbing';
    });

    window.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        pan.x = e.clientX - dragStart.x;
        pan.y = e.clientY - dragStart.y;
        applyTransform();
    });

    window.addEventListener('mouseup', () => {
        dragging = false;
        const container = document.getElementById('ast-graph-view');
        if (container) container.style.cursor = 'grab';
    });

    container.addEventListener('wheel', (e) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        const newZoom = Math.min(3, Math.max(0.1, zoom * delta));

        const rect = container.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        pan.x = mx - (mx - pan.x) * (newZoom / zoom);
        pan.y = my - (my - pan.y) * (newZoom / zoom);
        zoom = newZoom;
        applyTransform();
    }, { passive: false });
}

function applyTransform() {
    astSvg.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
    astSvg.style.transformOrigin = '0 0';
}

function resetPanZoom(svgW, svgH) {
    const container = document.getElementById('ast-graph-view');
    if (!container) return;

    const cw = container.clientWidth || 500;
    const ch = container.clientHeight || 400;

    const scaleX = (cw - 16) / svgW;
    const scaleY = (ch - 16) / svgH;
    zoom = Math.min(scaleX, scaleY, 1.2);

    pan = {
        x: Math.max(0, (cw - svgW * zoom) / 2),
        y: Math.max(8, (ch - svgH * zoom) / 2)
    };
    applyTransform();
}

// --- Utility ---

function applyFixit(startLine, startCol, endLine, endCol, text) {
    const lines = editor.value.split('\n');
    const fixText = text.replace(/\\n/g, '\n');

    if (startLine >= 1 && startLine <= lines.length) {
        const lineIdx = startLine - 1;
        const colIdx = startCol - 1;
        const line = lines[lineIdx];
        lines[lineIdx] = line.substring(0, colIdx) + fixText + line.substring(colIdx);
        editor.value = lines.join('\n');
        updateLineNumbers();
        setStatus('Fix applied! Re-analyze to verify.', 'success');
    }
}

function clearResults() {
    diagnosticsList.innerHTML = '';
    emptyState.style.display = '';
    astTree.innerHTML = '';
    astSvg.innerHTML = '';
    astEmpty.style.display = '';
    astViews.style.display = 'none';
    warningCountBadge.textContent = 'Ready';
    warningCountBadge.className = 'panel-badge';
    if (statusStats) statusStats.textContent = '';
    updateLineNumbers();
}

function showError(msg) {
    diagnosticsList.innerHTML = '';
    emptyState.style.display = 'none';
    const card = document.createElement('div');
    card.className = 'diag-card error';
    card.innerHTML = `
        <div class="diag-header">
            <span class="diag-icon">E</span>
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
