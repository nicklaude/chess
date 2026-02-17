/* 6D Chess – multiverse game controller with timeline branching */
var Game = {
    timelines: {},
    activeTimelineId: 0,
    nextTimelineId: 1,
    selected: null,
    selectedTimelineId: null,
    pendingPromotion: null, // { tlId, move } - awaiting promotion choice
    viewingMoveIndex: null, // null = current position, number = viewing history at that move index

    init: function () {
        var self = this;
        Board3D.init('scene-container', function (info) { self.handleClick(info); });

        document.getElementById('reset').addEventListener('click', function () {
            self.reset();
        });

        // Setup keyboard navigation
        this._setupKeyboardNav();

        // Setup move slider
        this._setupMoveSlider();

        // Create the main timeline
        this._createTimeline(0, 0, null, -1, null);
        this.setActiveTimeline(0);
        this.renderTimeline(0);
        this.updateStatus();
        this.updateTimelineList();
    },

    /* ── Keyboard Navigation ── */
    _setupKeyboardNav: function () {
        var self = this;
        document.addEventListener('keydown', function (e) {
            // Don't capture if typing in an input
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            switch (e.key) {
                case 'ArrowLeft':
                    e.preventDefault();
                    self.navigateMove(-1);
                    break;
                case 'ArrowRight':
                    e.preventDefault();
                    self.navigateMove(1);
                    break;
                case 'Tab':
                    e.preventDefault();
                    self.cycleTimeline(e.shiftKey ? -1 : 1);
                    break;
                case ' ':
                    e.preventDefault();
                    self.flipBoard();
                    break;
                case 'Home':
                    e.preventDefault();
                    self.goToMove(0);
                    break;
                case 'End':
                    e.preventDefault();
                    self.goToMove(-1); // -1 = last move
                    break;
                case 'f':
                case 'F':
                    e.preventDefault();
                    self.focusActiveTimeline();
                    break;
                case 'r':
                case 'R':
                    e.preventDefault();
                    self.resetCameraView();
                    break;
            }
        });
    },

    /* ── Move Slider ── */
    _setupMoveSlider: function () {
        var self = this;
        var sliderContainer = document.createElement('div');
        sliderContainer.id = 'move-slider-container';
        sliderContainer.innerHTML =
            '<input type="range" id="move-slider" min="0" max="0" value="0">' +
            '<div id="move-slider-label">Move 0/0</div>';

        // Insert before the moves panel
        var movesEl = document.getElementById('moves');
        movesEl.parentNode.insertBefore(sliderContainer, movesEl);

        var slider = document.getElementById('move-slider');
        slider.addEventListener('input', function () {
            self.goToMove(parseInt(this.value));
        });
    },

    _updateMoveSlider: function () {
        var slider = document.getElementById('move-slider');
        var label = document.getElementById('move-slider-label');
        var tl = this.timelines[this.activeTimelineId];
        if (!tl || !slider || !label) return;

        var totalMoves = tl.moveHistory.length;
        var currentMove = this.viewingMoveIndex !== null ? this.viewingMoveIndex : totalMoves;

        slider.max = totalMoves;
        slider.value = currentMove;
        label.textContent = 'Move ' + currentMove + '/' + totalMoves;

        // Visual indicator when not at current position
        if (this.viewingMoveIndex !== null && this.viewingMoveIndex < totalMoves) {
            label.classList.add('viewing-history');
        } else {
            label.classList.remove('viewing-history');
        }
    },

    /* ── Navigation Methods ── */
    navigateMove: function (delta) {
        var tl = this.timelines[this.activeTimelineId];
        if (!tl) return;

        var totalMoves = tl.moveHistory.length;
        var currentMove = this.viewingMoveIndex !== null ? this.viewingMoveIndex : totalMoves;
        var newMove = Math.max(0, Math.min(totalMoves, currentMove + delta));

        this.goToMove(newMove);
    },

    goToMove: function (moveIndex) {
        var tl = this.timelines[this.activeTimelineId];
        if (!tl) return;

        var totalMoves = tl.moveHistory.length;

        // -1 means go to last move (current position)
        if (moveIndex === -1) moveIndex = totalMoves;

        // Clamp to valid range
        moveIndex = Math.max(0, Math.min(totalMoves, moveIndex));

        // If at current position, clear viewing mode
        if (moveIndex === totalMoves) {
            this.viewingMoveIndex = null;
            this.renderTimeline(this.activeTimelineId);
        } else {
            this.viewingMoveIndex = moveIndex;
            // Render the board at that snapshot
            var snapshot = tl.snapshots[moveIndex];
            var board = this._getSnapshotBoard(snapshot);
            Board3D.getTimeline(this.activeTimelineId).render(board);
        }

        this._updateMoveSlider();
        this.updateStatus();
        this._highlightCurrentMoveInList();
    },

    _highlightCurrentMoveInList: function () {
        var movesEl = document.getElementById('moves');
        var pairs = movesEl.querySelectorAll('.move-pair');
        var tl = this.timelines[this.activeTimelineId];
        if (!tl) return;

        var totalMoves = tl.moveHistory.length;
        var viewingMove = this.viewingMoveIndex !== null ? this.viewingMoveIndex : totalMoves;

        pairs.forEach(function (pair, idx) {
            var pairStartMove = idx * 2 + 1; // Move 1 is at pair 0
            var pairEndMove = idx * 2 + 2;

            if (viewingMove >= pairStartMove && viewingMove <= pairEndMove) {
                pair.classList.add('current-move');
            } else if (viewingMove < pairStartMove) {
                pair.classList.add('future-move');
            } else {
                pair.classList.remove('current-move', 'future-move');
            }
        });
    },

    cycleTimeline: function (direction) {
        var ids = Object.keys(this.timelines).map(Number).sort(function (a, b) { return a - b; });
        if (ids.length <= 1) return;

        var currentIdx = ids.indexOf(this.activeTimelineId);
        var newIdx = (currentIdx + direction + ids.length) % ids.length;
        this.setActiveTimeline(ids[newIdx]);
    },

    flipBoard: function () {
        // Toggle camera position to flip perspective
        if (Board3D.controls) {
            var camera = Board3D.camera;
            var target = Board3D.controls.target;

            // Rotate camera 180 degrees around the Y axis relative to target
            var dx = camera.position.x - target.x;
            var dz = camera.position.z - target.z;

            camera.position.x = target.x - dx;
            camera.position.z = target.z - dz;

            Board3D.controls.update();
        }
    },

    focusActiveTimeline: function () {
        Board3D.focusTimeline(this.activeTimelineId, true);
    },

    resetCameraView: function () {
        // Reset to default camera position centered on active timeline
        var tl = this.timelines[this.activeTimelineId];
        var targetX = tl ? tl.xOffset : 0;

        Board3D.camera.position.set(targetX, 14, 12);
        Board3D.controls.target.set(targetX, 0, 0);
        Board3D.controls.update();
    },

    /* ── Timeline management ── */
    _createTimeline: function (id, xOffset, parentId, branchTurn, initialFen) {
        var chess;
        if (initialFen) {
            chess = new Chess(initialFen);
        } else {
            chess = new Chess();
        }

        this.timelines[id] = {
            id: id,
            chess: chess,
            moveHistory: [],
            snapshots: [],
            parentId: parentId,
            branchTurn: branchTurn,
            xOffset: xOffset,
            name: parentId === null ? 'Main' : 'Branch ' + id
        };

        // Take initial snapshot
        this.timelines[id].snapshots.push(this._cloneBoard(chess));

        Board3D.createTimeline(id, xOffset);
        return this.timelines[id];
    },

    getTimeline: function (id) { return this.timelines[id]; },

    setActiveTimeline: function (id) {
        var previousId = this.activeTimelineId;
        this.activeTimelineId = id;
        this.viewingMoveIndex = null; // Reset to current position when switching timelines
        Board3D.setActiveTimeline(id);
        this.clearSelection();
        this.updateStatus();
        this.updateMoveList();
        this.updateTimelineList();
        this._updateMoveSlider();

        // Auto-focus on the new timeline with animation (if switching timelines)
        if (previousId !== id) {
            Board3D.focusTimeline(id, true);
        }
    },

    /* ── Click handling ── */
    handleClick: function (info) {
        var tlId = info.timelineId;
        var sq = info.square;
        var isHistory = info.isHistory;
        var turn = info.turn;

        // Clicking on a history board → potential fork
        if (isHistory) {
            this._handleHistoryClick(tlId, turn, sq);
            return;
        }

        // Clicking on a non-active timeline's current board → switch to it
        if (tlId !== this.activeTimelineId) {
            this.setActiveTimeline(tlId);
        }

        // Normal board interaction on active timeline
        this._handleBoardClick(tlId, sq);
    },

    _handleBoardClick: function (tlId, sq) {
        var tl = this.timelines[tlId];
        if (!tl) return;
        var chess = tl.chess;
        var piece = chess.get(sq);
        var col = Board3D.getTimeline(tlId);

        if (this.selected && this.selectedTimelineId === tlId) {
            // Try to make a move
            var moves = chess.moves({ square: this.selected, verbose: true });
            var targetMove = null;
            for (var i = 0; i < moves.length; i++) {
                if (moves[i].to === sq) { targetMove = moves[i]; break; }
            }

            if (targetMove) {
                this.makeMove(tlId, targetMove);
                return;
            }

            if (sq === this.selected) {
                this.clearSelection();
                return;
            }
        }

        if (piece && piece.color === chess.turn()) {
            this.clearSelection();
            this.selected = sq;
            this.selectedTimelineId = tlId;
            var legalMoves = chess.moves({ square: sq, verbose: true });
            col.select(sq);
            col.showLegalMoves(legalMoves, chess.board());
        } else {
            this.clearSelection();
        }
    },

    _handleHistoryClick: function (tlId, turnIndex, sq) {
        var tl = this.timelines[tlId];
        if (!tl) return;

        // Get the board state at that turn
        // turnIndex 0 = most recent history, which is snapshot at (total snapshots - 2)
        var snapshotIdx = tl.snapshots.length - 2 - turnIndex;
        if (snapshotIdx < 0) return;

        var snapshot = tl.snapshots[snapshotIdx];
        if (!snapshot) return;

        // Check if there's a piece belonging to current turn player
        var pos = this._fromSq(sq);
        var board = this._getSnapshotBoard(snapshot);
        var piece = board[pos.r][pos.c];
        if (!piece) return;

        // Determine whose turn it was at that snapshot
        // Try to get turn from FEN first (accurate for nested forks)
        var turnColor = this._getSnapshotTurn(snapshot);
        if (!turnColor) {
            // Fallback for old snapshots without FEN: use index parity
            // (This is less accurate for nested forks but maintains backward compat)
            turnColor = snapshotIdx % 2 === 0 ? 'w' : 'b';
        }
        if (piece.color !== turnColor) return;

        // Fork! Create a new timeline from this point
        this._forkTimeline(tlId, snapshotIdx, sq);
    },

    _forkTimeline: function (parentTlId, snapshotIdx, selectedSq) {
        var parentTl = this.timelines[parentTlId];
        var snapshot = parentTl.snapshots[snapshotIdx];

        // Get FEN from snapshot if available (new format), otherwise replay moves
        var fen = this._getSnapshotFen(snapshot);
        if (!fen) {
            // Fallback: Rebuild the FEN by replaying moves (for old snapshots without FEN)
            var forkChess = new Chess();
            for (var i = 0; i < snapshotIdx; i++) {
                if (i < parentTl.moveHistory.length) {
                    var histMove = parentTl.moveHistory[i];
                    var moveObj = {
                        from: histMove.from,
                        to: histMove.to
                    };
                    // Use the actual promotion piece that was played
                    if (histMove.promotion) {
                        moveObj.promotion = histMove.promotion;
                    }
                    forkChess.move(moveObj);
                }
            }
            fen = forkChess.fen();
        }

        var newId = this.nextTimelineId++;

        // Calculate x offset: alternate left/right of parent
        var existingCount = Object.keys(this.timelines).length;
        var side = existingCount % 2 === 0 ? 1 : -1;
        var xOffset = parentTl.xOffset + side * Board3D.TIMELINE_SPACING * Math.ceil(existingCount / 2);

        var newTl = this._createTimeline(newId, xOffset, parentTlId, snapshotIdx, fen);

        // Copy snapshots up to the fork point
        newTl.snapshots = [];
        for (var s = 0; s <= snapshotIdx; s++) {
            newTl.snapshots.push(this._deepCloneSnapshot(parentTl.snapshots[s]));
        }

        // Replay the corresponding move history up to fork point
        // (snapshots has snapshotIdx+1 entries, so moveHistory needs snapshotIdx entries)
        newTl.moveHistory = [];
        for (var m = 0; m < snapshotIdx; m++) {
            if (m < parentTl.moveHistory.length) {
                newTl.moveHistory.push(JSON.parse(JSON.stringify(parentTl.moveHistory[m])));
            }
        }

        // Validate snapshot consistency on the new timeline
        this._validateSnapshotConsistency(newTl);

        // Add snapshots as history layers on the new timeline visual
        // (skip index 0 = initial state, add pairs as before-move states)
        for (var h = newTl.moveHistory.length - 1; h >= 0; h--) {
            var mv = newTl.moveHistory[h];
            var boardBefore = this._getSnapshotBoard(newTl.snapshots[h]);
            Board3D.getTimeline(newId).addSnapshot(boardBefore, mv.from, mv.to, mv.isWhite);
        }

        // Add branch connection line
        Board3D.addBranchLine(parentTlId, Math.max(0, parentTl.moveHistory.length - snapshotIdx - 1), newId);

        // Switch to the new timeline
        this.setActiveTimeline(newId);
        this.renderTimeline(newId);

        // Auto-select the piece on the new timeline
        this.selected = selectedSq;
        this.selectedTimelineId = newId;
        var col = Board3D.getTimeline(newId);
        var legalMoves = newTl.chess.moves({ square: selectedSq, verbose: true });
        col.select(selectedSq);
        col.showLegalMoves(legalMoves, newTl.chess.board());

        this.updateTimelineList();
    },

    /* ── Move execution ── */
    makeMove: function (tlId, move, promotionPiece) {
        var tl = this.timelines[tlId];
        if (!tl) return;
        var chess = tl.chess;
        var isWhite = chess.turn() === 'w';

        // Check if this is a pawn promotion move that needs user input
        if (move.flags && move.flags.indexOf('p') !== -1 && !promotionPiece) {
            // Show promotion picker and wait for user choice
            this.pendingPromotion = { tlId: tlId, move: move };
            this._showPromotionPicker(tlId, move.to, isWhite);
            return;
        }

        var boardBefore = this._cloneBoard(chess);

        // Use the provided promotion piece, or default to queen for non-promotion moves
        var moveObj = { from: move.from, to: move.to };
        if (move.flags && move.flags.indexOf('p') !== -1) {
            moveObj.promotion = promotionPiece || 'q';
        }

        var result = chess.move(moveObj);
        if (!result) {
            console.error('Invalid move:', moveObj);
            return;
        }

        // Store the actual promotion piece used (if any)
        tl.moveHistory.push({
            from: move.from, to: move.to,
            piece: move.piece, captured: move.captured || null,
            san: result.san, isWhite: isWhite,
            promotion: result.promotion || null // Store actual promotion piece
        });

        tl.snapshots.push(this._cloneBoard(chess));

        // Validate snapshot/moveHistory consistency
        this._validateSnapshotConsistency(tl);

        var col = Board3D.getTimeline(tlId);
        col.addSnapshot(this._getSnapshotBoard(boardBefore), move.from, move.to, isWhite);
        col.addMoveLine(move.from, move.to, isWhite);

        this.clearSelection();
        col.showLastMove(move.from, move.to);
        this.renderTimeline(tlId);
        this.updateStatus();
        this.updateMoveList();
        this.updateTimelineList();
        this._updateMoveSlider();
    },

    /* ── Promotion UI ── */
    _showPromotionPicker: function (tlId, square, isWhite) {
        var self = this;
        var existing = document.getElementById('promotion-picker');
        if (existing) existing.remove();

        var picker = document.createElement('div');
        picker.id = 'promotion-picker';
        picker.innerHTML = '<div class="promo-title">Promote to:</div>' +
            '<div class="promo-options">' +
            '<button data-piece="q" title="Queen">' + (isWhite ? '♕' : '♛') + '</button>' +
            '<button data-piece="r" title="Rook">' + (isWhite ? '♖' : '♜') + '</button>' +
            '<button data-piece="b" title="Bishop">' + (isWhite ? '♗' : '♝') + '</button>' +
            '<button data-piece="n" title="Knight">' + (isWhite ? '♘' : '♞') + '</button>' +
            '</div>';

        picker.querySelectorAll('button').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var piece = this.getAttribute('data-piece');
                picker.remove();
                if (self.pendingPromotion) {
                    var pending = self.pendingPromotion;
                    self.pendingPromotion = null;
                    self.makeMove(pending.tlId, pending.move, piece);
                }
            });
        });

        document.getElementById('sidebar').appendChild(picker);
    },

    /* ── Snapshot consistency validation ── */
    _validateSnapshotConsistency: function (tl) {
        // Invariant: snapshots.length === moveHistory.length + 1
        // (snapshot[0] is initial state, each move adds one snapshot)
        if (tl.snapshots.length !== tl.moveHistory.length + 1) {
            console.error('SNAPSHOT CONSISTENCY ERROR:', {
                timeline: tl.id,
                snapshotsLength: tl.snapshots.length,
                moveHistoryLength: tl.moveHistory.length,
                expected: 'snapshots.length === moveHistory.length + 1'
            });
            throw new Error('GameStateError: Snapshot/moveHistory mismatch on timeline ' + tl.id);
        }
    },

    /* ── Rendering ── */
    renderTimeline: function (tlId) {
        var tl = this.timelines[tlId];
        if (!tl) return;
        Board3D.getTimeline(tlId).render(tl.chess.board());
    },

    clearSelection: function () {
        if (this.selectedTimelineId !== null) {
            var col = Board3D.getTimeline(this.selectedTimelineId);
            if (col) col.clearHighlights();
        }
        this.selected = null;
        this.selectedTimelineId = null;
    },

    /* ── Board cloning ── */
    // Snapshot format: { fen: string, board: 8x8 array }
    // - fen: full game state for reconstruction (includes castling, en passant, etc.)
    // - board: piece positions for rendering
    _cloneBoard: function (chess) {
        var board = chess.board();
        var boardClone = [];
        for (var r = 0; r < 8; r++) {
            boardClone[r] = [];
            for (var c = 0; c < 8; c++) {
                var p = board[r][c];
                boardClone[r][c] = p ? { type: p.type, color: p.color } : null;
            }
        }
        return {
            fen: chess.fen(),
            board: boardClone
        };
    },

    _deepCloneSnapshot: function (snapshot) {
        // Handle both old format (array) and new format (object with fen/board)
        if (Array.isArray(snapshot)) {
            // Old format: just board array
            var clone = [];
            for (var r = 0; r < 8; r++) {
                clone[r] = [];
                for (var c = 0; c < 8; c++) {
                    var p = snapshot[r][c];
                    clone[r][c] = p ? { type: p.type, color: p.color } : null;
                }
            }
            return clone;
        }
        // New format: { fen, board }
        var boardClone = [];
        for (var r = 0; r < 8; r++) {
            boardClone[r] = [];
            for (var c = 0; c < 8; c++) {
                var p = snapshot.board[r][c];
                boardClone[r][c] = p ? { type: p.type, color: p.color } : null;
            }
        }
        return {
            fen: snapshot.fen,
            board: boardClone
        };
    },

    // Helper to get board array from snapshot (handles both formats)
    _getSnapshotBoard: function (snapshot) {
        if (Array.isArray(snapshot)) return snapshot;
        return snapshot.board;
    },

    // Helper to get FEN from snapshot (returns null for old format)
    _getSnapshotFen: function (snapshot) {
        if (Array.isArray(snapshot)) return null;
        return snapshot.fen;
    },

    // Helper to get turn from snapshot
    _getSnapshotTurn: function (snapshot) {
        var fen = this._getSnapshotFen(snapshot);
        if (fen) {
            // FEN format: "position turn castling enpassant halfmove fullmove"
            // Turn is the second field
            return fen.split(' ')[1]; // 'w' or 'b'
        }
        return null;
    },

    _fromSq: function (sq) {
        return { r: 8 - parseInt(sq[1]), c: sq.charCodeAt(0) - 97 };
    },

    /* ── UI updates ── */
    updateStatus: function () {
        var statusEl = document.getElementById('status');
        var tl = this.timelines[this.activeTimelineId];
        if (!tl) return;
        var chess = tl.chess;
        var turn = chess.turn() === 'w' ? 'White' : 'Black';
        var prefix = Object.keys(this.timelines).length > 1
            ? '[' + tl.name + '] ' : '';

        if (chess.in_checkmate()) {
            var winner = chess.turn() === 'w' ? 'Black' : 'White';
            statusEl.textContent = prefix + 'Checkmate! ' + winner + ' wins';
            statusEl.style.color = '#ff6b6b';
        } else if (chess.in_draw()) {
            statusEl.textContent = prefix + 'Draw!';
            statusEl.style.color = '#ffd93d';
        } else if (chess.in_check()) {
            statusEl.textContent = prefix + turn + ' \u2014 Check!';
            statusEl.style.color = '#ff6b6b';
        } else {
            statusEl.textContent = prefix + turn + ' to move';
            statusEl.style.color = '#e0e0e0';
        }
    },

    updateMoveList: function () {
        var movesEl = document.getElementById('moves');
        var tl = this.timelines[this.activeTimelineId];
        if (!tl) { movesEl.innerHTML = ''; return; }
        var history = tl.chess.history();
        var html = '';
        for (var i = 0; i < history.length; i += 2) {
            var num = Math.floor(i / 2) + 1;
            var white = history[i];
            var black = history[i + 1] || '';
            html += '<div class="move-pair">' +
                '<span class="move-number">' + num + '.</span>' +
                '<span class="move">' + white + '</span>' +
                '<span class="move">' + black + '</span></div>';
        }
        movesEl.innerHTML = html;
        movesEl.scrollTop = movesEl.scrollHeight;
    },

    updateTimelineList: function () {
        var listEl = document.getElementById('timeline-list');
        var html = '';
        var self = this;
        var colors = Board3D.TIMELINE_COLORS;

        // Build parent-child relationships
        var childrenOf = {}; // parentId -> [childIds]
        for (var key in this.timelines) {
            var tl = this.timelines[key];
            if (tl.parentId !== null) {
                if (!childrenOf[tl.parentId]) childrenOf[tl.parentId] = [];
                childrenOf[tl.parentId].push(tl.id);
            }
        }

        for (var key in this.timelines) {
            var tl = this.timelines[key];
            var id = tl.id;
            var isActive = id === this.activeTimelineId;
            var color = colors[id % colors.length];
            var hexColor = '#' + color.toString(16).padStart(6, '0');
            var turnCount = tl.chess.history().length;

            // Check if this timeline has children (is a branch point)
            var hasChildren = childrenOf[id] && childrenOf[id].length > 0;
            var branchCount = hasChildren ? childrenOf[id].length : 0;

            // Build branch indicator
            var branchIndicator = '';
            if (hasChildren) {
                branchIndicator = '<span class="tl-branch-count" title="' + branchCount + ' branch(es)">' +
                    '⑂' + branchCount + '</span>';
            }

            // Show parent info for child timelines
            var parentInfo = '';
            if (tl.parentId !== null) {
                var parentTl = this.timelines[tl.parentId];
                var parentName = parentTl ? parentTl.name : 'Unknown';
                parentInfo = '<span class="tl-parent" title="Branched from ' + parentName +
                    ' at move ' + tl.branchTurn + '">↳ ' + parentName + '@' + tl.branchTurn + '</span>';
            }

            html += '<div class="tl-item' + (isActive ? ' active' : '') +
                (hasChildren ? ' has-branches' : '') +
                '" data-tl-id="' + id + '" data-children="' + (childrenOf[id] || []).join(',') + '">' +
                '<span class="tl-dot" style="background:' + hexColor + '"></span>' +
                '<div class="tl-info">' +
                '<span class="tl-label">' + tl.name + branchIndicator + '</span>' +
                parentInfo +
                '</div>' +
                '<span class="tl-turn">' + turnCount + '</span></div>';
        }

        listEl.innerHTML = html;

        // Attach click and hover handlers
        var items = listEl.querySelectorAll('.tl-item');
        for (var i = 0; i < items.length; i++) {
            (function (item) {
                var tlId = parseInt(item.dataset.tlId);

                // Click to select timeline
                item.addEventListener('click', function () {
                    self.setActiveTimeline(tlId);
                });

                // Hover to highlight connected timelines
                item.addEventListener('mouseenter', function () {
                    self._highlightConnectedTimelines(tlId, true);
                });

                item.addEventListener('mouseleave', function () {
                    self._highlightConnectedTimelines(tlId, false);
                });
            })(items[i]);
        }
    },

    /* ── Branch Point Indicators ── */
    _highlightConnectedTimelines: function (tlId, highlight) {
        var tl = this.timelines[tlId];
        if (!tl) return;

        // Find all connected timelines (parent and children)
        var connected = [];

        // Add parent
        if (tl.parentId !== null) {
            connected.push(tl.parentId);
        }

        // Add children
        for (var key in this.timelines) {
            var other = this.timelines[key];
            if (other.parentId === tlId) {
                connected.push(other.id);
            }
        }

        // Highlight/unhighlight in UI
        var listEl = document.getElementById('timeline-list');
        connected.forEach(function (connectedId) {
            var item = listEl.querySelector('[data-tl-id="' + connectedId + '"]');
            if (item) {
                if (highlight) {
                    item.classList.add('connected-highlight');
                } else {
                    item.classList.remove('connected-highlight');
                }
            }
        });

        // Highlight in 3D view
        connected.forEach(function (connectedId) {
            var col = Board3D.getTimeline(connectedId);
            if (col) {
                col.setHighlighted(highlight);
            }
        });
    },

    /* ── Get branch points for a timeline ── */
    getBranchPoints: function (tlId) {
        var branches = [];
        for (var key in this.timelines) {
            var tl = this.timelines[key];
            if (tl.parentId === tlId) {
                branches.push({
                    childId: tl.id,
                    moveIndex: tl.branchTurn,
                    name: tl.name
                });
            }
        }
        return branches;
    },

    /* ── Reset ── */
    reset: function () {
        Board3D.clearAll();
        this.timelines = {};
        this.nextTimelineId = 1;
        this.selected = null;
        this.selectedTimelineId = null;
        document.getElementById('moves').innerHTML = '';

        this._createTimeline(0, 0, null, -1, null);
        this.setActiveTimeline(0);
        this.renderTimeline(0);
        this.updateStatus();
        this.updateTimelineList();
    }
};

document.addEventListener('DOMContentLoaded', function () {
    Game.init();
});
