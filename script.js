const SIZE = 4;
const KEY_BEST = "2048-best";
const KEY_STATE = "2048-game-state";

function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
        if (k === "className") node.className = v;
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

class Game2048 {
    constructor() {
        this.board = this.makeEmptyBoard();
        this.score = 0;
        this.best = Number(localStorage.getItem(KEY_BEST) || 0);
        this.undoStack = [];
        
        this.tileDom = new Map();
        
        this.initializeElements();
        this.setupEventListeners();
        this.loadGameState() || this.newGame();
    }
    
    initializeElements() {
        this.boardEl = document.getElementById("board");
        this.tilesLayer = document.getElementById("tiles");
        this.btnNew = document.getElementById("new-game");
        this.btnUndo = document.getElementById("undo");
        this.scoreEl = document.getElementById("score");
        this.bestEl = document.getElementById("best");
        
        this.buildGrid();
    }
    
    buildGrid() {
        this.boardEl.querySelectorAll(".cell").forEach(n => n.remove());
        for (let r = 0; r < SIZE; r++) {
            for (let c = 0; c < SIZE; c++) {
                this.boardEl.insertBefore(
                    el("div", { className: "cell" }),
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
            v: Math.random() < 0.9 ? 2 : 4
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
                    node = el("div", { className: `tile v${t.v}` });
                    node.style.width = size + "px";
                    node.style.height = size + "px";
                    node.style.setProperty("--x", x + "px");
                    node.style.setProperty("--y", y + "px");
                    node.textContent = String(t.v);
                    this.tilesLayer.appendChild(node);
                    this.tileDom.set(t.id, node);
                } else {
                    node.style.width = size + "px";
                    node.style.height = size + "px";
                    node.style.setProperty("--x", x + "px");
                    node.style.setProperty("--y", y + "px");
                    node.className = `tile v${t.v}`;
                    node.textContent = String(t.v);
                }
                seen.delete(t.id);
            }
        }
        
        for (const id of seen) {
            const n = this.tileDom.get(id);
            if (n) n.remove();
            this.tileDom.delete(id);
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
                        v: nv
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
    
    pushUndo() {
        this.undoStack.push({ b: this.cloneBoard(this.board), s: this.score });
        if (this.undoStack.length > 30) this.undoStack.shift();
        this.btnUndo.disabled = false;
        this.saveGameState();
    }
    
    undo() {
        if (!this.undoStack.length) return;
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
    }
    
    handleMove(dir) {
        this.pushUndo();
        const res = this.moveWithPlan(this.board, dir);
        
        if (!res.moved) {
            this.undoStack.pop();
            this.btnUndo.disabled = this.undoStack.length === 0;
            return;
        }
        
        // Простая анимация перемещения
        setTimeout(() => {
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
                alert("Игра окончена! Ваш счет: " + this.score);
                this.newGame();
            }
        }, 100);
    }
    
    setupEventListeners() {
        window.addEventListener("keydown", (e) => {
            const k = e.key.toLowerCase();
            if (k.startsWith("arrow")) e.preventDefault();
            
            if (k === 'arrowleft' || k === 'a') this.handleMove('left');
            else if (k === 'arrowright' || k === 'd') this.handleMove('right');
            else if (k === 'arrowup' || k === 'w') this.handleMove('up');
            else if (k === 'arrowdown' || k === 's') this.handleMove('down');
        });

        this.btnNew.addEventListener("click", () => this.newGame());
        this.btnUndo.addEventListener("click", () => this.undo());

        let touchStartX = 0;
        let touchStartY = 0;

        this.boardEl.addEventListener("touchstart", (e) => {
            const t = e.touches[0];
            touchStartX = t.clientX;
            touchStartY = t.clientY;
        }, { passive: true });

        this.boardEl.addEventListener("touchend", (e) => {
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

        window.addEventListener("beforeunload", () => this.saveGameState());
    }
}

document.addEventListener("DOMContentLoaded", () => {
    new Game2048();
});