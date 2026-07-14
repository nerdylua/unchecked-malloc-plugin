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
const astInspector = document.getElementById('ast-inspector');
const fitAstButton = document.getElementById('ast-fit-btn');

let presets = [];
let currentAstData = null;
let astState = null;

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
    fitAstButton.addEventListener('click', () => fitAstGraph());
});

function switchTab(tab) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.querySelector(`.tab[data-tab="${tab}"]`).classList.add('active');
    document.getElementById(tab === 'results' ? 'results-content' : 'ast-content').classList.add('active');
    if (tab === 'ast' && astState) requestAnimationFrame(() => fitAstGraph());
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

    if (data.error || !data.tree || !data.tree.children || data.tree.children.length === 0) {
        astState = null;
        astEmpty.style.display = '';
        astViews.style.display = 'none';
        astInspector.innerHTML = '<span class="ast-inspector-placeholder">No source AST is available for this input.</span>';
        return;
    }

    astEmpty.style.display = 'none';
    astViews.style.display = 'flex';

    currentAstData = data.tree;
    astState = {
        rawTree: data.tree,
        selectedId: null,
        positions: new Map(),
        graphSize: { width: 0, height: 0 }
    };
    renderAstExplorer(true);
}

const AST_H_GAP = 24;
const AST_V_GAP = 42;
const AST_PADDING = 30;
const AST_MAX_NODE_WIDTH = 280;
const astMeasureCanvas = document.createElement('canvas');
const astMeasureContext = astMeasureCanvas.getContext('2d');

function renderAstExplorer(resetView) {
    if (!astState) return;
    const tree = astState.rawTree;
    astTree.innerHTML = '';
    astTree.appendChild(buildListNode(tree, true));
    renderSvgTree(tree, resetView);
    renderInspector(findAstNode(tree, astState.selectedId));
}

function findAstNode(node, id) {
    if (!id) return null;
    if (node.id === id) return node;
    for (const child of node.children || []) {
        const found = findAstNode(child, id);
        if (found) return found;
    }
    return null;
}

function selectAstNode(node) {
    astState.selectedId = node.id;
    renderAstExplorer(false);
}

// --- List view ---

function buildListNode(node, isRoot) {
    const el = document.createElement('div');
    el.className = `ast-node${isRoot ? ' ast-node-root' : ''}`;
    const hasChildren = node.children && node.children.length > 0;

    const header = document.createElement('button');
    header.type = 'button';
    header.className = `ast-node-header${astState.selectedId === node.id ? ' selected' : ''}`;
    header.innerHTML = '<span class="ast-toggle leaf"></span>';

    const typeSpan = document.createElement('span');
    typeSpan.className = `ast-type ${node.category || 'other'}`;
    typeSpan.textContent = node.label;
    const detailSpan = document.createElement('span');
    detailSpan.className = 'ast-detail';
    detailSpan.textContent = node.summary || node.kind;
    header.append(typeSpan, detailSpan);
    header.addEventListener('click', () => selectAstNode(node));
    el.appendChild(header);

    if (hasChildren) {
        const childContainer = document.createElement('div');
        childContainer.className = 'ast-children';
        node.children.forEach(child => childContainer.appendChild(buildListNode(child, false)));
        el.appendChild(childContainer);
    }
    return el;
}

// --- SVG graph view ---

function wrapAstText(text, maxWidth, font) {
    if (!text) return [];
    astMeasureContext.font = font;
    const words = String(text).split(/\s+/);
    const lines = [];
    let line = '';
    words.forEach(word => {
        const pieces = [];
        let remaining = word;
        while (remaining && astMeasureContext.measureText(remaining).width > maxWidth) {
            let end = remaining.length - 1;
            while (end > 1 && astMeasureContext.measureText(remaining.slice(0, end)).width > maxWidth) end -= 1;
            pieces.push(remaining.slice(0, end));
            remaining = remaining.slice(end);
        }
        pieces.push(remaining);
        pieces.forEach(piece => {
            const trial = line ? `${line} ${piece}` : piece;
            if (line && astMeasureContext.measureText(trial).width > maxWidth) {
                lines.push(line);
                line = piece;
            } else {
                line = trial;
            }
        });
    });
    if (line) lines.push(line);
    return lines;
}

function measureAstNodes(node, depth, levelHeights) {
    const labelLines = wrapAstText(node.label, AST_MAX_NODE_WIDTH - 36, '600 12px JetBrains Mono');
    const summaryLines = wrapAstText(node.summary || node.kind, AST_MAX_NODE_WIDTH - 36, '11px JetBrains Mono');
    astMeasureContext.font = '600 12px JetBrains Mono';
    const labelWidth = Math.max(...labelLines.map(line => astMeasureContext.measureText(line).width), 0);
    astMeasureContext.font = '11px JetBrains Mono';
    const summaryWidth = Math.max(...summaryLines.map(line => astMeasureContext.measureText(line).width), 0);
    const textWidth = Math.max(
        labelWidth,
        summaryWidth,
        120
    );
    node.render = {
        labelLines,
        summaryLines,
        w: Math.min(AST_MAX_NODE_WIDTH, Math.max(156, Math.ceil(textWidth) + 36)),
        h: 22 + labelLines.length * 16 + summaryLines.length * 14
    };
    levelHeights[depth] = Math.max(levelHeights[depth] || 0, node.render.h);
    node.children.forEach(child => measureAstNodes(child, depth + 1, levelHeights));
}

function layoutAstTree(node, depth, levelOffsets) {
    const children = node.children.map(child => layoutAstTree(child, depth + 1, levelOffsets));
    const childrenWidth = children.length
        ? children.reduce((sum, child) => sum + child.totalW, 0) + (children.length - 1) * AST_H_GAP
        : 0;
    const totalW = Math.max(node.render.w, childrenWidth);
    let offset = (totalW - childrenWidth) / 2;
    children.forEach(child => {
        shiftAstX(child, offset);
        offset += child.totalW + AST_H_GAP;
    });
    return { ...node, x: (totalW - node.render.w) / 2, y: levelOffsets[depth], totalW, children };
}

function shiftAstX(node, dx) {
    node.x += dx;
    node.children.forEach(child => shiftAstX(child, dx));
}

function renderSvgTree(tree, resetView) {
    const levelHeights = [];
    measureAstNodes(tree, 0, levelHeights);
    const levelOffsets = [];
    let y = 0;
    levelHeights.forEach(height => { levelOffsets.push(y); y += height + AST_V_GAP; });
    const laid = layoutAstTree(tree, 0, levelOffsets);
    const totalW = laid.totalW + AST_PADDING * 2;
    const totalH = y - AST_V_GAP + AST_PADDING * 2;
    const previousPositions = astState.positions;
    astState.positions = new Map();
    astState.graphSize = { width: totalW, height: totalH };

    astSvg.innerHTML = '';
    astSvg.setAttribute('width', totalW);
    astSvg.setAttribute('height', totalH);
    astSvg.style.width = `${totalW}px`;
    astSvg.style.height = `${totalH}px`;
    const graph = svgEl('g', { transform: `translate(${AST_PADDING}, ${AST_PADDING})` });
    drawAstEdges(graph, laid);
    drawAstNodes(graph, laid, previousPositions);
    astSvg.appendChild(graph);
    if (resetView) requestAnimationFrame(() => fitAstGraph());
}

function drawAstEdges(parent, node) {
    node.children.forEach(child => {
        const x1 = node.x + node.render.w / 2;
        const y1 = node.y + node.render.h;
        const x2 = child.x + child.render.w / 2;
        const y2 = child.y;
        const midY = (y1 + y2) / 2;
        parent.appendChild(svgEl('path', {
            d: `M${x1},${y1} C${x1},${midY} ${x2},${midY} ${x2},${y2}`,
            class: 'ast-edge', fill: 'none'
        }));
        drawAstEdges(parent, child);
    });
}

function drawAstNodes(parent, node, previousPositions) {
    const group = svgEl('g', {
        class: `ast-graph-node ${node.category || 'other'}${astState.selectedId === node.id ? ' selected' : ''}`,
        role: 'button', tabindex: '0', 'aria-label': `${node.label}: ${node.summary || node.kind}`
    });
    const targetX = node.x;
    const targetY = node.y;
    const previous = previousPositions.get(node.id);
    group.style.transform = `translate(${previous ? previous.x : targetX}px, ${previous ? previous.y : targetY}px)`;
    astState.positions.set(node.id, { x: targetX, y: targetY });
    group.appendChild(svgEl('title')).textContent = `${node.label}\n${node.kind}\n${node.summary || ''}`;
    group.appendChild(svgEl('rect', { width: node.render.w, height: node.render.h, rx: 8, ry: 8 }));
    let textY = 18;
    node.render.labelLines.forEach(line => {
        const text = svgEl('text', { x: 14, y: textY, class: 'ast-graph-label' });
        text.textContent = line;
        group.appendChild(text);
        textY += 16;
    });
    node.render.summaryLines.forEach(line => {
        const text = svgEl('text', { x: 14, y: textY, class: 'ast-graph-summary' });
        text.textContent = line;
        group.appendChild(text);
        textY += 14;
    });
    group.addEventListener('click', event => {
        event.stopPropagation();
        selectAstNode(node);
    });
    group.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            selectAstNode(node);
        }
    });
    parent.appendChild(group);
    requestAnimationFrame(() => { group.style.transform = `translate(${targetX}px, ${targetY}px)`; });
    node.children.forEach(child => drawAstNodes(parent, child, previousPositions));
}

function renderInspector(node) {
    if (!node) {
        astInspector.innerHTML = '<span class="ast-inspector-placeholder">Select a node to inspect its Clang details.</span>';
        return;
    }
    const loc = node.location || {};
    const position = loc.line ? `Line ${loc.line}:${loc.column || 1}` : 'No source location';
    const metadata = JSON.stringify(node.metadata || {}, null, 2);
    astInspector.innerHTML = `
        <div class="ast-inspector-title">${escapeHtml(node.label)}</div>
        <div class="ast-inspector-kind">${escapeHtml(node.kind)}</div>
        <div class="ast-inspector-location">${escapeHtml(position)}</div>
        ${node.sourceExcerpt ? `<code class="ast-source-excerpt">${escapeHtml(node.sourceExcerpt)}</code>` : ''}
        <details><summary>Full Clang metadata</summary><pre>${escapeHtml(metadata)}</pre></details>`;
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
        const modeScale = e.deltaMode === 1 ? 16 : (e.deltaMode === 2 ? container.clientHeight : 1);
        const normalizedDelta = Math.max(-400, Math.min(400, e.deltaY * modeScale));
        // Exponential scaling makes frequent, small touchpad events precise
        // while retaining a useful zoom step for a traditional mouse wheel.
        const zoomFactor = Math.exp(-normalizedDelta * 0.0014);
        const newZoom = Math.min(3, Math.max(0.1, zoom * zoomFactor));

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

function fitAstGraph() {
    const container = document.getElementById('ast-graph-view');
    if (!container) return;

    const { width: svgW, height: svgH } = astState ? astState.graphSize : { width: 0, height: 0 };
    if (!svgW || !svgH) return;

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
    astState = null;
    astInspector.innerHTML = '<span class="ast-inspector-placeholder">Select a node to inspect its Clang details.</span>';
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
