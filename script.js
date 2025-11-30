const SIZE = 4;
const KEY_BEST = "flower-field-best";
const KEY_LEADERS = "flower-field-leaders";
const KEY_STATE = "flower-field-game-state";

function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
        if (k === "className") node.className = v;
        else if (k === "text") node.textContent = v;
        else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v);
    }
    for (const ch of children.flat()) {
        if (ch == null) continue;
        node.appendChild(typeof ch === "string" ? document.createTextNode(ch) : ch);
    }
    return node;
}

function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

class FlowerFieldGame {
    constructor() {
        this.board = this.makeEmptyBoard();
        this.score = 0;
        this.best = Number(localStorage.getItem(KEY_BEST) || 0);
        this.undoStack = [];
        this.animating = false;
        
        this.tileDom = new Map();
        
        this.initializeElements();
        this.setupEventListeners();
        this.loadGameState() || this.newGame();
        this.renderLeaders();
    }
    
    initializeElements() {
        this.boardEl = document.getElementById("board");
        this.tilesLayer = document.getElementById("tiles");
        this.btnNew = document.getElementById("new-game");
        this.btnUndo = document.getElementById("undo");
        this.btnShowLeaders = document.getElementById("show-leaders");
        this.scoreEl = document.getElementById("score");
        this.bestEl = document.getElementById("best");
        
        this.gameOverModal = document.getElementById("game-over");
        this.finalScoreEl = document.getElementById("final-score");
        this.nameForm = document.getElementById("name-form");
        this.playerNameInput = document.getElementById("player-name");
        this.saveSuccess = document.getElementById("save-success");
        this.restartBtn = document.getElementById("restart");
        
        this.leadersModal = document.getElementById("leaders-modal");
        this.closeLeaders = document.getElementById("close-leaders");
        this.closeLeadersBtn = document.getElementById("close-leaders-btn");
        this.leadersTable = document.querySelector("#leaders-table tbody");
        
        this.buildGrid();
    }
    
    buildGrid() {
        if (this.tilesLayer.parentElement !== this.boardEl) {
            this.boardEl.appendChild(this.tilesLayer);
        }
        
        this.boardEl.querySelectorAll(".cell").forEach(n => n.remove());
        for (let r = 0; r < SIZE; r++) {
            for (let c = 0; c < SIZE; c++) {
                this.boardEl.insertBefore(
                    el("div", {
                        className: "cell",
                        "data-row": String(r),
                        "data-col": String(c)
                    }),
                    this.tilesLayer
                );
            }
        }
    }
    
    makeEmptyBoard() {
        return Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
    }
    
    cloneBoard(b) {
        return b.map(row => row.map(t => t ? { ...t } : null));
    }
    
    randomEmptyCell(b) {
        const empty = [];
        for (let r = 0; r < SIZE; r++) {
            for (let c = 0; c < SIZE; c++) {
                if (!b[r][c]) empty.push([r, c]);
            }
        }
        if (empty.length === 0) return null;
        return empty[Math.floor(Math.random() * empty.length)];
    }
    
    spawnRandom(b) {
        const cell = this.randomEmptyCell(b);
        if (!cell) return false;
        const [r, c] = cell;
        b[r][c] = {
            id: uid(),
            v: Math.random() < 0.9 ? 2 : 4,
            spawn: true
        };
        return true;
    }
    
    metrics() {
        const gap = parseFloat(getComputedStyle(this.boardEl).gap);
        const inner = this.tilesLayer.clientWidth;
        const size = (inner - gap * (SIZE - 1)) / SIZE;
        return { gap, size };
    }
    
    xyFor(r, c) {
        const { gap, size } = this.metrics();
        return {
            x: c * (size + gap),
            y: r * (size + gap),
            size
        };
    }
    
    renderTiles() {
        const { gap, size } = this.metrics();
        const seen = new Set(this.tileDom.keys());
        
        for (let r = 0; r < SIZE; r++) {
            for (let c = 0; c < SIZE; c++) {
                const t = this.board[r][c];
                if (!t) continue;
                
                const { x, y } = this.xyFor(r, c);
                let node = this.tileDom.get(t.id);
                
                if (!node) {
                    if (this.animating) continue;
                    node = el("div", { className: `tile v${t.v}` });
                    node.style.width = size + "px";
                    node.style.height = size + "px";
                    node.style.setProperty("--x", x + "px");
                    node.style.setProperty("--y", y + "px");
                    node.textContent = String(t.v);
                    this.tilesLayer.appendChild(node);
                    
                    if (t.spawn) {
                        node.classList.add("spawn");
                        t.spawn = false;
                    } else if (t.merge) {
                        node.classList.add("merge");
                        t.merge = false;
                    }
                    
                    this.tileDom.set(t.id, node);
                } else {
                    node.style.width = size + "px";
                    node.style.height = size + "px";
                    node.style.setProperty("--x", x + "px");
                    node.style.setProperty("--y", y + "px");
                    node.className = `tile v${t.v}`;
                    node.textContent = String(t.v);
                    
                    if (t.merge) {
                        node.classList.add("merge");
                        t.merge = false;
                    }
                }
                seen.delete(t.id);
            }
        }
        
        if (!this.animating) {
            for (const id of seen) {
                const n = this.tileDom.get(id);
                if (n) n.remove();
                this.tileDom.delete(id);
            }
        }
        
        this.renderScore();
    }
    
    renderScore() {
        this.scoreEl.textContent = String(this.score);
        this.bestEl.textContent = String(this.best);
    }
    
    moveWithPlan(b, dir) {
        const plan = [];
        let gained = 0;
        
        const seq = (i) => {
            if (dir === "left") return Array.from({ length: SIZE }, (_, j) => [i, j]);
            if (dir === "right") return Array.from({ length: SIZE }, (_, j) => [i, SIZE - 1 - j]);
            if (dir === "up") return Array.from({ length: SIZE }, (_, j) => [j, i]);
            return Array.from({ length: SIZE }, (_, j) => [SIZE - 1 - j, i]);
        };

        for (let i = 0; i < SIZE; i++) {
            const coords = seq(i);
            const tiles = [];
            
            for (const [r, c] of coords) {
                if (b[r][c]) tiles.push({ t: b[r][c], r, c });
            }
            
            const out = Array(SIZE).fill(null);
            let w = 0;
            let k = 0;
            
            while (k < tiles.length) {
                const a = tiles[k];
                const hasB = k + 1 < tiles.length && tiles[k + 1].t.v === a.t.v;
                const [wr, wc] = coords[w];
                
                if (hasB) {
                    const b2 = tiles[k + 1];
                    const nv = a.t.v * 2;
                    out[w] = {
                        id: uid(),
                        v: nv,
                        merge: true
                    };
                    gained += nv;
                    
                    plan.push({
                        id: a.t.id,
                        from: [a.r, a.c],
                        to: [wr, wc],
                        remove: true
                    });
                    plan.push({
                        id: b2.t.id,
                        from: [b2.r, b2.c],
                        to: [wr, wc],
                        remove: true
                    });
                    w++;
                    k += 2;
                } else {
                    out[w] = {
                        id: a.t.id,
                        v: a.t.v
                    };
                    plan.push({
                        id: a.t.id,
                        from: [a.r, a.c],
                        to: [wr, wc],
                        remove: false
                    });
                    w++;
                    k += 1;
                }
            }
            
            for (let j = 0; j < SIZE; j++) {
                const [r, c] = coords[j];
                b[r][c] = out[j];
            }
        }
        
        const moved = plan.some(m => m.from[0] !== m.to[0] || m.from[1] !== m.to[1] || m.remove);
        return { moved, gained, plan };
    }
    
    canMove(b) {
        for (let r = 0; r < SIZE; r++) {
            for (let c = 0; c < SIZE; c++) {
                if (!b[r][c]) return true;
            }
        }
        
        for (let r = 0; r < SIZE; r++) {
            for (let c = 0; c < SIZE; c++) {
                const t = b[r][c];
                if (!t) continue;
                
                if (r + 1 < SIZE && b[r + 1][c] && b[r + 1][c].v === t.v) return true;
                if (c + 1 < SIZE && b[r][c + 1] && b[r][c + 1].v === t.v) return true;
            }
        }
        return false;
    }
    
    animatePlan(plan, done) {
        this.animating = true;
        const updates = [];
        
        for (const m of plan) {
            const n = this.tileDom.get(m.id);
            if (!n) continue;
            
            const { x, y, size } = this.xyFor(m.to[0], m.to[1]);
            n.style.width = size + "px";
            n.style.height = size + "px";
            n.style.setProperty("--x", x + "px");
            n.style.setProperty("--y", y + "px");
            updates.push({ node: n, remove: m.remove });
        }
        
        setTimeout(() => {
            for (const u of updates) {
                if (u.remove) {
                    if (u.node.parentNode) u.node.parentNode.removeChild(u.node);
                    for (const [id, el] of this.tileDom.entries()) {
                        if (el === u.node) this.tileDom.delete(id);
                    }
                }
            }
            this.animating = false;
            done();
        }, 200);
    }
    
    loadLeaders() {
        try {
            const raw = localStorage.getItem(KEY_LEADERS);
            const arr = raw ? JSON.parse(raw) : [];
            return Array.isArray(arr) ? arr : [];
        } catch {
            return [];
        }
    }
    
    saveLeader(name, points) {
        const arr = this.loadLeaders();
        arr.push({
            name: String(name || "Игрок").slice(0, 24),
            score: Number(points) || 0,
            ts: Date.now(),
            date: new Date().toLocaleDateString('ru-RU')
        });
        arr.sort((a, b) => b.score - a.score || a.ts - b.ts);
        localStorage.setItem(KEY_LEADERS, JSON.stringify(arr.slice(0, 10)));
        this.renderLeaders();
    }
    
    renderLeaders() {
        while (this.leadersTable.firstChild) {
            this.leadersTable.removeChild(this.leadersTable.firstChild);
        }
        
        this.loadLeaders().forEach((rec, idx) => {
            const row = el("tr");
            row.innerHTML = `
                <td>${idx + 1}</td>
                <td>${rec.name}</td>
                <td>${rec.score}</td>
                <td>${rec.date}</td>
            `;
            this.leadersTable.appendChild(row);
        });
    }
    
    saveGameState() {
        const gameState = {
            board: this.board,
            score: this.score,
            best: this.best,
            undoStack: this.undoStack
        };
        localStorage.setItem(KEY_STATE, JSON.stringify(gameState));
    }
    
    loadGameState() {
        try {
            const saved = localStorage.getItem(KEY_STATE);
            if (saved) {
                const state = JSON.parse(saved);
                this.board = state.board || this.makeEmptyBoard();
                this.score = state.score || 0;
                this.best = state.best || 0;
                this.undoStack = state.undoStack || [];
                this.btnUndo.disabled = this.undoStack.length === 0;
                this.renderTiles();
                this.renderScore();
                return true;
            }
        } catch (e) {
            console.warn("Failed to load game state:", e);
        }
        return false;
    }
    
    finishGame() {
        this.finalScoreEl.textContent = String(this.score);
        this.playerNameInput.value = "";
        this.saveSuccess.classList.add("hidden");
        this.nameForm.classList.remove("hidden");
        this.gameOverModal.classList.remove("hidden");
        this.playerNameInput.focus();
    }
    
    closeModal() {
        this.gameOverModal.classList.add("hidden");
    }
    
    showLeaders() {
        this.renderLeaders();
        this.leadersModal.classList.remove("hidden");
    }
    
    hideLeaders() {
        this.leadersModal.classList.add("hidden");
    }
    
    pushUndo() {
        this.undoStack.push({ b: this.cloneBoard(this.board), s: this.score });
        if (this.undoStack.length > 30) this.undoStack.shift();
        this.btnUndo.disabled = false;
        this.saveGameState();
    }
    
    undo() {
        if (!this.undoStack.length || this.animating) return;
        const prev = this.undoStack.pop();
        this.board = prev.b;
        this.score = prev.s;
        this.btnUndo.disabled = this.undoStack.length === 0;
        this.renderTiles();
        this.renderScore();
        this.saveGameState();
    }
    
    newGame() {
        this.board = this.makeEmptyBoard();
        this.score = 0;
        this.undoStack = [];
        this.btnUndo.disabled = true;
        this.tileDom.clear();
        
        this.spawnRandom(this.board);
        this.spawnRandom(this.board);
        
        this.renderTiles();
        this.renderScore();
        this.saveGameState();
        this.closeModal();
    }
    
    handleMove(dir) {
        if (this.animating) return;
        
        this.pushUndo();
        const res = this.moveWithPlan(this.board, dir);
        
        if (!res.moved) {
            this.undoStack.pop();
            this.btnUndo.disabled = this.undoStack.length === 0;
            return;
        }
        
        this.animatePlan(res.plan, () => {
            this.score += res.gained;
            if (this.score > this.best) {
                this.best = this.score;
                localStorage.setItem(KEY_BEST, String(this.best));
            }
            
            this.spawnRandom(this.board);
            this.renderTiles();
            this.renderScore();
            this.saveGameState();
            
            if (!this.canMove(this.board)) {
                setTimeout(() => this.finishGame(), 300);
            }
        });
    }
    
    setupEventListeners() {
        window.addEventListener("keydown", (e) => {
            if (this.gameOverModal.classList.contains("hidden") && 
                this.leadersModal.classList.contains("hidden")) {
                const k = e.key.toLowerCase();
                if (k.startsWith("arrow")) e.preventDefault();
                
                if (k === 'arrowleft' || k === 'a') this.handleMove('left');
                else if (k === 'arrowright' || k === 'd') this.handleMove('right');
                else if (k === 'arrowup' || k === 'w') this.handleMove('up');
                else if (k === 'arrowdown' || k === 's') this.handleMove('down');
            }
        });

        this.btnNew.addEventListener("click", () => this.newGame());
        this.btnUndo.addEventListener("click", () => this.undo());
        this.btnShowLeaders.addEventListener("click", () => this.showLeaders());
        this.restartBtn.addEventListener("click", () => this.newGame());

        let touchStartX = 0;
        let touchStartY = 0;

        this.boardEl.addEventListener("touchstart", (e) => {
            if (!this.gameOverModal.classList.contains("hidden") || 
                !this.leadersModal.classList.contains("hidden")) return;
            const t = e.touches[0];
            touchStartX = t.clientX;
            touchStartY = t.clientY;
        }, { passive: true });

        this.boardEl.addEventListener("touchend", (e) => {
            if (!this.gameOverModal.classList.contains("hidden") || 
                !this.leadersModal.classList.contains("hidden")) return;
            
            const t = e.changedTouches[0];
            const dx = t.clientX - touchStartX;
            const dy = t.clientY - touchStartY;
            const ax = Math.abs(dx);
            const ay = Math.abs(dy);
            
            if (Math.max(ax, ay) < 24) return;
            
            if (ax > ay) {
                this.handleMove(dx > 0 ? 'right' : 'left');
            } else {
                this.handleMove(dy > 0 ? 'down' : 'up');
            }
        });

        this.nameForm.addEventListener("submit", (e) => {
            e.preventDefault();
            const playerName = (this.playerNameInput.value || "").trim() || "Игрок";
            this.saveLeader(playerName, this.score);
            this.nameForm.classList.add("hidden");
            this.saveSuccess.classList.remove("hidden");
            setTimeout(() => {
                this.closeModal();
                this.newGame();
            }, 1500);
        });

        this.closeLeaders.addEventListener("click", () => this.hideLeaders());
        this.closeLeadersBtn.addEventListener("click", () => this.hideLeaders());

        [this.gameOverModal, this.leadersModal].forEach(modal => {
            modal.addEventListener("click", (e) => {
                if (e.target === modal) {
                    if (modal === this.gameOverModal) {
                        this.closeModal();
                    } else {
                        this.hideLeaders();
                    }
                }
            });
        });

        window.addEventListener("beforeunload", () => this.saveGameState());
    }
}

document.addEventListener("DOMContentLoaded", () => {
    new FlowerFieldGame();
});