/* Three.js 6D Chess – multiverse with timeline branching */

/* ── Timeline column (one per timeline) ── */
function TimelineCol(scene, id, xOffset, tintColor, texCache, pieceChars, pieceTex) {
    this.scene = scene;
    this.id = id;
    this.xOffset = xOffset;
    this.tint = tintColor;
    this._texCache = texCache;
    this._pieceChars = pieceChars;
    this._pieceTex = pieceTex;

    this.group = new THREE.Group();
    this.group.position.x = xOffset;

    this.squareMeshes = [];
    this.pieceMeshes = [];
    this.highlightMeshes = [];
    this.lastMoveHL = [];
    this.historyLayers = [];
    this.historySquareMeshes = [];

    this.moveLineGroup = new THREE.Group();
    this.interLayerGroup = new THREE.Group();
    this.group.add(this.moveLineGroup);
    this.group.add(this.interLayerGroup);

    this._buildBoard();
    scene.add(this.group);
}

TimelineCol.LAYER_GAP = 2.8;
TimelineCol.MAX_LAYERS = 12;

TimelineCol.prototype._toSq = function (r, c) {
    return String.fromCharCode(97 + c) + (8 - r);
};
TimelineCol.prototype._fromSq = function (sq) {
    return { r: 8 - parseInt(sq[1]), c: sq.charCodeAt(0) - 97 };
};
TimelineCol.prototype._sqToWorld = function (sq, y) {
    var p = this._fromSq(sq);
    return new THREE.Vector3(p.c - 3.5 + this.xOffset, y || 0, p.r - 3.5);
};

/* board base + squares */
TimelineCol.prototype._buildBoard = function () {
    var base = new THREE.Mesh(
        new THREE.BoxGeometry(8.6, 0.18, 8.6),
        new THREE.MeshStandardMaterial({ color: 0x15152a, metalness: 0.7, roughness: 0.3 })
    );
    base.position.y = -0.14;
    base.receiveShadow = true;
    this.group.add(base);

    var trim = new THREE.Mesh(
        new THREE.BoxGeometry(8.8, 0.06, 8.8),
        new THREE.MeshStandardMaterial({ color: 0x333366, metalness: 0.9, roughness: 0.2 })
    );
    trim.position.y = -0.24;
    this.group.add(trim);

    for (var r = 0; r < 8; r++) {
        for (var c = 0; c < 8; c++) {
            var isLight = (r + c) % 2 === 0;
            var mat = new THREE.MeshStandardMaterial({
                color: isLight ? 0x7575a8 : 0x44446e,
                metalness: 0.15, roughness: 0.75
            });
            var mesh = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.07, 0.96), mat);
            mesh.position.set(c - 3.5, 0, r - 3.5);
            mesh.receiveShadow = true;
            mesh.userData = {
                square: this._toSq(r, c), row: r, col: c,
                origColor: mat.color.getHex(),
                timelineId: this.id, turn: -1
            };
            this.squareMeshes.push(mesh);
            this.group.add(mesh);
        }
    }

    this._addLabels();
};

TimelineCol.prototype._addLabels = function () {
    var files = 'abcdefgh';
    for (var i = 0; i < 8; i++) {
        var f = Board3D._textSprite(files[i], '#7777aa');
        f.position.set(i - 3.5, 0.05, 4.4);
        f.scale.set(0.35, 0.35, 0.35);
        this.group.add(f);
        var rk = Board3D._textSprite(String(8 - i), '#7777aa');
        rk.position.set(-4.4, 0.05, i - 3.5);
        rk.scale.set(0.35, 0.35, 0.35);
        this.group.add(rk);
    }
};

/* render pieces on current board */
TimelineCol.prototype.render = function (position) {
    var i;
    for (i = 0; i < this.pieceMeshes.length; i++) this.group.remove(this.pieceMeshes[i]);
    this.pieceMeshes = [];
    for (var r = 0; r < 8; r++) {
        for (var c = 0; c < 8; c++) {
            var piece = position[r][c];
            if (!piece) continue;
            var isW = piece.color === 'w';
            var chKey = isW ? piece.type.toUpperCase() : piece.type;
            var tex = this._pieceTex(this._pieceChars[chKey], isW);
            var sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
            sprite.position.set(c - 3.5, 0.38, r - 3.5);
            sprite.scale.set(0.88, 0.88, 0.88);
            this.pieceMeshes.push(sprite);
            this.group.add(sprite);
        }
    }
};

/* highlight / selection */
TimelineCol.prototype.select = function (sq) {
    this.clearHighlights();
    var pos = this._fromSq(sq);
    var m = this.squareMeshes[pos.r * 8 + pos.c];
    m.material.color.setHex(0xbba030);
    m.material.emissive = new THREE.Color(0x554410);
    this.highlightMeshes.push({ type: 'sq', mesh: m });
};

TimelineCol.prototype.showLegalMoves = function (moves, position) {
    for (var i = 0; i < moves.length; i++) {
        var p = this._fromSq(moves[i].to);
        var hasPiece = position[p.r][p.c] !== null;
        var geo = hasPiece ? new THREE.RingGeometry(0.34, 0.44, 32) : new THREE.CircleGeometry(0.14, 32);
        var mat = new THREE.MeshBasicMaterial({
            color: 0xffdd44, transparent: true, opacity: 0.5,
            side: THREE.DoubleSide, depthWrite: false
        });
        var ind = new THREE.Mesh(geo, mat);
        ind.rotation.x = -Math.PI / 2;
        ind.position.set(p.c - 3.5, 0.06, p.r - 3.5);
        this.group.add(ind);
        this.highlightMeshes.push({ type: 'ind', mesh: ind });
    }
};

TimelineCol.prototype.showLastMove = function (from, to) {
    var i;
    for (i = 0; i < this.lastMoveHL.length; i++) this.group.remove(this.lastMoveHL[i]);
    this.lastMoveHL = [];
    var sqs = [from, to];
    for (i = 0; i < 2; i++) {
        var pos = this._fromSq(sqs[i]);
        var pl = new THREE.Mesh(
            new THREE.PlaneGeometry(0.96, 0.96),
            new THREE.MeshBasicMaterial({ color: 0x4488ff, transparent: true, opacity: 0.15, side: THREE.DoubleSide, depthWrite: false })
        );
        pl.rotation.x = -Math.PI / 2;
        pl.position.set(pos.c - 3.5, 0.055, pos.r - 3.5);
        this.group.add(pl);
        this.lastMoveHL.push(pl);
    }
};

TimelineCol.prototype.clearHighlights = function () {
    for (var i = 0; i < this.highlightMeshes.length; i++) {
        var h = this.highlightMeshes[i];
        if (h.type === 'sq') {
            h.mesh.material.color.setHex(h.mesh.userData.origColor);
            h.mesh.material.emissive = new THREE.Color(0);
        } else {
            this.group.remove(h.mesh);
        }
    }
    this.highlightMeshes = [];
};

/* persistent move lines on current board */
TimelineCol.prototype.addMoveLine = function (fromSq, toSq, isWhite) {
    var a = this._sqToWorld(fromSq, 0.09);
    var b = this._sqToWorld(toSq, 0.09);
    a.x -= this.xOffset; b.x -= this.xOffset;
    var col = isWhite ? 0x4488ff : 0xff7744;
    this.moveLineGroup.add(Board3D._glowTube(a, b, col, 0.018, 0.07, false));
};

/* history snapshot */
TimelineCol.prototype.addSnapshot = function (position, moveFrom, moveTo, isWhite) {
    var layerGroup = this._makeHistoryBoard(position);
    layerGroup.userData = { moveFrom: moveFrom, moveTo: moveTo, isWhite: isWhite };
    this.historyLayers.unshift(layerGroup);
    this.group.add(layerGroup);

    while (this.historyLayers.length > TimelineCol.MAX_LAYERS) {
        var old = this.historyLayers.pop();
        this._removeHistorySquares(old);
        this.group.remove(old);
    }
    this._layoutLayers();
};

TimelineCol.prototype._makeHistoryBoard = function (position) {
    var g = new THREE.Group();
    var turnIndex = this.historyLayers.length;
    var sqMeshes = [];

    var base = new THREE.Mesh(
        new THREE.BoxGeometry(8.2, 0.03, 8.2),
        new THREE.MeshStandardMaterial({ color: 0x15152a, transparent: true, opacity: 0.25, metalness: 0.5, roughness: 0.5 })
    );
    base.position.y = -0.02; // Slightly below squares to prevent z-fighting
    g.add(base);

    for (var r = 0; r < 8; r++) {
        for (var c = 0; c < 8; c++) {
            var isLight = (r + c) % 2 === 0;
            var m = new THREE.Mesh(
                new THREE.BoxGeometry(0.93, 0.025, 0.93),
                new THREE.MeshStandardMaterial({
                    color: isLight ? 0x7575a8 : 0x44446e,
                    transparent: true, opacity: 0.2, metalness: 0.15, roughness: 0.8
                })
            );
            m.position.set(c - 3.5, 0, r - 3.5);
            m.userData = {
                square: this._toSq(r, c), row: r, col: c,
                origColor: m.material.color.getHex(),
                timelineId: this.id, turn: turnIndex,
                isHistory: true
            };
            g.add(m);
            sqMeshes.push(m);
        }
    }

    // Pieces
    for (var r2 = 0; r2 < 8; r2++) {
        for (var c2 = 0; c2 < 8; c2++) {
            var piece = position[r2][c2];
            if (!piece) continue;
            var isW = piece.color === 'w';
            var chKey = isW ? piece.type.toUpperCase() : piece.type;
            var tex = this._pieceTex(this._pieceChars[chKey], isW);
            var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.35, depthWrite: false }));
            sp.position.set(c2 - 3.5, 0.25, r2 - 3.5);
            sp.scale.set(0.7, 0.7, 0.7);
            g.add(sp);
        }
    }

    g.userData.sqMeshes = sqMeshes;
    this.historySquareMeshes = this.historySquareMeshes.concat(sqMeshes);
    return g;
};

TimelineCol.prototype._removeHistorySquares = function (layerGroup) {
    var toRemove = layerGroup.userData.sqMeshes || [];
    this.historySquareMeshes = this.historySquareMeshes.filter(function (m) {
        return toRemove.indexOf(m) === -1;
    });
};

TimelineCol.prototype._layoutLayers = function () {
    var i, j;
    for (i = 0; i < this.historyLayers.length; i++) {
        this.historyLayers[i].position.y = -(i + 1) * TimelineCol.LAYER_GAP;
        var op = Math.max(0.06, 0.38 - i * 0.025);
        this._setGroupOpacity(this.historyLayers[i], op);
        // Update turn indices for history squares
        var sqs = this.historyLayers[i].userData.sqMeshes || [];
        for (j = 0; j < sqs.length; j++) sqs[j].userData.turn = i;
    }

    // Rebuild inter-layer lines
    while (this.interLayerGroup.children.length)
        this.interLayerGroup.remove(this.interLayerGroup.children[0]);

    for (j = 0; j < this.historyLayers.length; j++) {
        var layer = this.historyLayers[j];
        var fromSq = layer.userData.moveFrom;
        var toSq = layer.userData.moveTo;
        var isW = layer.userData.isWhite;

        var fromY = layer.position.y + 0.1;
        var toY = j === 0 ? 0.1 : this.historyLayers[j - 1].position.y + 0.1;
        var fromW = new THREE.Vector3().copy(this._sqToWorld(fromSq, fromY));
        var toW = new THREE.Vector3().copy(this._sqToWorld(toSq, toY));
        fromW.x -= this.xOffset;
        toW.x -= this.xOffset;
        var lineCol = isW ? 0x44ddff : 0xffaa33;
        this.interLayerGroup.add(Board3D._glowTube(fromW, toW, lineCol, 0.025, 0.1, true));
    }
};

TimelineCol.prototype._setGroupOpacity = function (group, opacity) {
    group.traverse(function (child) {
        if (child.material && child.material.transparent) {
            child.material.opacity = child.isSprite ? opacity * 1.1 : opacity;
        }
    });
};

TimelineCol.prototype.getAllSquareMeshes = function () {
    return this.squareMeshes.concat(this.historySquareMeshes);
};

TimelineCol.prototype.setActive = function (active) {
    // Subtle edge glow on active timeline
    this.group.children.forEach(function (child) {
        if (child.geometry && child.geometry.type === 'BoxGeometry' &&
            child.geometry.parameters.width > 8.5 && child.position.y < -0.1) {
            child.material.emissive = active ? new THREE.Color(0x222244) : new THREE.Color(0);
        }
    });
};

TimelineCol.prototype.setHighlighted = function (highlighted) {
    // Add glow effect to the board base when highlighted
    var self = this;
    this.group.children.forEach(function (child) {
        if (child.geometry && child.geometry.type === 'BoxGeometry' &&
            child.geometry.parameters.width > 8.5 && child.position.y < -0.1) {
            if (highlighted) {
                child.material.emissive = new THREE.Color(0x446688);
            } else {
                // Reset to default (check if active)
                child.material.emissive = new THREE.Color(0);
            }
        }
    });
};

TimelineCol.prototype.clearAll = function () {
    var i;
    for (i = 0; i < this.historyLayers.length; i++) this.group.remove(this.historyLayers[i]);
    this.historyLayers = [];
    this.historySquareMeshes = [];
    while (this.moveLineGroup.children.length) this.moveLineGroup.remove(this.moveLineGroup.children[0]);
    while (this.interLayerGroup.children.length) this.interLayerGroup.remove(this.interLayerGroup.children[0]);
    this.clearHighlights();
    for (i = 0; i < this.lastMoveHL.length; i++) this.group.remove(this.lastMoveHL[i]);
    this.lastMoveHL = [];
};

TimelineCol.prototype.destroy = function () {
    this.clearAll();
    this.scene.remove(this.group);
};


/* ══════════════════════════════════════════════════════════════
   Board3D – scene manager, coordinates multiple timelines
   ══════════════════════════════════════════════════════════════ */
var Board3D = {
    scene: null, camera: null, renderer: null, controls: null,
    raycaster: null, mouse: null, container: null,
    _clock: null, _downPos: null, _texCache: {},

    timelineCols: {},
    branchLineGroup: null,
    particleSystem: null,
    onSquareClick: null,

    PIECE_CHARS: {
        K: '\u2654', Q: '\u2655', R: '\u2656', B: '\u2657', N: '\u2658', P: '\u2659',
        k: '\u265A', q: '\u265B', r: '\u265C', b: '\u265D', n: '\u265E', p: '\u265F'
    },

    TIMELINE_COLORS: [0x44ddff, 0xff66aa, 0x66ff88, 0xffaa33, 0xaa66ff, 0xff4444, 0x44ffcc, 0xffff44],
    TIMELINE_SPACING: 12,

    init: function (containerId, onSquareClick) {
        this.onSquareClick = onSquareClick;
        this.container = document.getElementById(containerId);
        this._clock = new THREE.Clock();
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();

        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
        this.renderer.setClearColor(0x080818);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.container.appendChild(this.renderer.domElement);

        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0x080818, 0.008);

        var aspect = this.container.clientWidth / this.container.clientHeight;
        this.camera = new THREE.PerspectiveCamera(50, aspect, 0.1, 300);
        this.camera.position.set(0, 14, 12);

        this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.08;
        this.controls.rotateSpeed = 0.7;
        this.controls.panSpeed = 0.8;
        this.controls.zoomSpeed = 1.2;
        this.controls.minDistance = 5;
        this.controls.maxDistance = 80;
        this.controls.maxPolarAngle = Math.PI * 0.85;
        this.controls.target.set(0, 0, 0);
        this.controls.screenSpacePanning = true;

        // WASD panning state and Q/E zoom
        this._panKeys = { w: false, a: false, s: false, d: false, q: false, e: false };
        this._panSpeed = 0.25;
        this._zoomSpeed = 0.4;

        this._setupLights();
        this.branchLineGroup = new THREE.Group();
        this.scene.add(this.branchLineGroup);
        this._createFloor();
        this._createParticles();

        var self = this;
        this.renderer.domElement.addEventListener('pointerdown', function (e) {
            self._downPos = { x: e.clientX, y: e.clientY };
        });
        this.renderer.domElement.addEventListener('pointerup', function (e) {
            if (!self._downPos) return;
            var dx = e.clientX - self._downPos.x;
            var dy = e.clientY - self._downPos.y;
            if (dx * dx + dy * dy < 36) self._onClick(e);
            self._downPos = null;
        });
        window.addEventListener('resize', function () { self._onResize(); });

        // WASD keyboard panning
        window.addEventListener('keydown', function (e) { self._onKeyDown(e); });
        window.addEventListener('keyup', function (e) { self._onKeyUp(e); });

        this._animate();
    },

    /* create / get timeline */
    createTimeline: function (id, xOffset) {
        var col = new TimelineCol(
            this.scene, id, xOffset,
            this.TIMELINE_COLORS[id % this.TIMELINE_COLORS.length],
            this._texCache, this.PIECE_CHARS,
            this._pieceTexture.bind(this)
        );
        this.timelineCols[id] = col;
        return col;
    },

    getTimeline: function (id) { return this.timelineCols[id]; },

    removeTimeline: function (id) {
        if (this.timelineCols[id]) {
            this.timelineCols[id].destroy();
            delete this.timelineCols[id];
        }
    },

    /* add a glow branch line between two timelines */
    addBranchLine: function (fromTlId, fromTurn, toTlId) {
        var fromCol = this.timelineCols[fromTlId];
        var toCol = this.timelineCols[toTlId];
        if (!fromCol || !toCol) return;

        var fromY = -(fromTurn + 1) * TimelineCol.LAYER_GAP;
        var from = new THREE.Vector3(fromCol.xOffset, fromY + 0.2, 0);
        var to = new THREE.Vector3(toCol.xOffset, 0.2, 0);
        var tintCol = this.TIMELINE_COLORS[toTlId % this.TIMELINE_COLORS.length];
        this.branchLineGroup.add(Board3D._glowTube(from, to, tintCol, 0.04, 0.18, true));
    },

    setActiveTimeline: function (id) {
        for (var key in this.timelineCols) {
            this.timelineCols[key].setActive(parseInt(key) === id);
        }
    },

    /* Smoothly pan camera to center on a timeline */
    focusTimeline: function (id, animate) {
        var col = this.timelineCols[id];
        if (!col) return;

        var targetX = col.xOffset;
        var currentTarget = this.controls.target.clone();
        var newTarget = new THREE.Vector3(targetX, 0, 0);

        if (animate) {
            // Cancel any existing animation and start fresh
            var startTime = this._clock.getElapsedTime();
            var duration = 0.4; // seconds

            this._focusTween = {
                start: currentTarget,
                end: newTarget,
                startTime: startTime,
                duration: duration
            };
        } else {
            // Immediate snap
            var delta = new THREE.Vector3().subVectors(newTarget, currentTarget);
            this.controls.target.add(delta);
            this.camera.position.add(delta);
        }
    },

    /* Update focus animation in render loop */
    _updateFocusAnimation: function () {
        if (!this._focusTween) return;

        var t = this._clock.getElapsedTime();
        var elapsed = t - this._focusTween.startTime;
        var progress = Math.min(elapsed / this._focusTween.duration, 1);

        // Ease out cubic
        var eased = 1 - Math.pow(1 - progress, 3);

        var newTarget = new THREE.Vector3().lerpVectors(
            this._focusTween.start,
            this._focusTween.end,
            eased
        );

        var delta = new THREE.Vector3().subVectors(newTarget, this.controls.target);
        this.controls.target.add(delta);
        this.camera.position.add(delta);

        if (progress >= 1) {
            this._focusTween = undefined;
        }
    },

    /* Lights */
    _setupLights: function () {
        this.scene.add(new THREE.AmbientLight(0x404060, 0.5));
        var dir = new THREE.DirectionalLight(0xffffff, 0.7);
        dir.position.set(5, 15, 8);
        dir.castShadow = true;
        dir.shadow.mapSize.set(2048, 2048);
        dir.shadow.camera.left = -20; dir.shadow.camera.right = 20;
        dir.shadow.camera.top = 20;  dir.shadow.camera.bottom = -20;
        dir.shadow.camera.near = 1;  dir.shadow.camera.far = 60;
        this.scene.add(dir);
        var p1 = new THREE.PointLight(0x4466ff, 0.5, 50);
        p1.position.set(-12, 8, -8); this.scene.add(p1);
        var p2 = new THREE.PointLight(0xff6644, 0.35, 50);
        p2.position.set(12, 8, 8); this.scene.add(p2);
    },

    _createFloor: function () {
        var g = new THREE.GridHelper(80, 80, 0x222244, 0x111133);
        g.position.y = -0.3;
        g.material.transparent = true; g.material.opacity = 0.12;
        this.scene.add(g);
    },

    _createParticles: function () {
        var n = 400, pos = new Float32Array(n * 3);
        for (var i = 0; i < n; i++) {
            pos[i * 3] = (Math.random() - 0.5) * 70;
            pos[i * 3 + 1] = Math.random() * 30 - 10;
            pos[i * 3 + 2] = (Math.random() - 0.5) * 70;
        }
        var geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        this.particleSystem = new THREE.Points(geo, new THREE.PointsMaterial({
            color: 0x6688cc, size: 0.07, transparent: true,
            opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false
        }));
        this.scene.add(this.particleSystem);
    },

    /* piece texture factory */
    _pieceTexture: function (symbol, isWhite) {
        var key = symbol + (isWhite ? 'w' : 'b');
        if (this._texCache[key]) return this._texCache[key];
        var s = 256, cv = document.createElement('canvas');
        cv.width = s; cv.height = s;
        var ctx = cv.getContext('2d');
        ctx.clearRect(0, 0, s, s);
        ctx.font = (s * 0.78) + 'px serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        if (isWhite) {
            ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 6;
            ctx.fillStyle = '#f0ece0'; ctx.fillText(symbol, s / 2, s / 2);
            ctx.shadowBlur = 0;
            ctx.strokeStyle = 'rgba(40,30,10,0.25)'; ctx.lineWidth = 1.5;
            ctx.strokeText(symbol, s / 2, s / 2);
        } else {
            ctx.shadowColor = 'rgba(80,80,140,0.5)'; ctx.shadowBlur = 8;
            ctx.fillStyle = '#303048'; ctx.fillText(symbol, s / 2, s / 2);
            ctx.shadowBlur = 0;
            ctx.strokeStyle = '#aaaacc'; ctx.lineWidth = 2.5;
            ctx.strokeText(symbol, s / 2, s / 2);
        }
        var tex = new THREE.CanvasTexture(cv);
        this._texCache[key] = tex;
        return tex;
    },

    /* text sprite helper */
    _textSprite: function (text, color) {
        var c = document.createElement('canvas');
        c.width = 64; c.height = 64;
        var ctx = c.getContext('2d');
        ctx.font = 'bold 48px sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = color; ctx.fillText(text, 32, 32);
        return new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true }));
    },

    /* glow tube (static helper) */
    _glowTube: function (from, to, color, coreR, glowR, arc) {
        var group = new THREE.Group();
        var curve;
        if (arc) {
            var mid = new THREE.Vector3().lerpVectors(from, to, 0.5);
            var hDir = new THREE.Vector2(mid.x, mid.z);
            var hLen = hDir.length();
            if (hLen > 0.01) { hDir.normalize(); mid.x += hDir.x * 0.7; mid.z += hDir.y * 0.7; }
            curve = new THREE.QuadraticBezierCurve3(from, mid, to);
        } else {
            curve = new THREE.LineCurve3(from, to);
        }
        var segs = arc ? 24 : 8;

        group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, segs, glowR, 8, false),
            new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false })));
        group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, segs, glowR * 0.45, 8, false),
            new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false })));
        group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, segs, coreR, 8, false),
            new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false })));

        var sg = new THREE.SphereGeometry(coreR * 2.2, 12, 12);
        var sm = new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false });
        var s1 = new THREE.Mesh(sg, sm); s1.position.copy(from); group.add(s1);
        var s2 = new THREE.Mesh(sg.clone(), sm.clone()); s2.position.copy(to); group.add(s2);
        return group;
    },

    /* WASD keyboard panning handlers */
    _onKeyDown: function (e) {
        // Don't capture if typing in an input
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        var key = e.key.toLowerCase();
        if (key === 'w' || key === 'a' || key === 's' || key === 'd' || key === 'q' || key === 'e') {
            e.preventDefault();
            this._panKeys[key] = true;
        }
    },

    _onKeyUp: function (e) {
        var key = e.key.toLowerCase();
        if (key === 'w' || key === 'a' || key === 's' || key === 'd' || key === 'q' || key === 'e') {
            this._panKeys[key] = false;
        }
    },

    _updatePanning: function () {
        if (!this._panKeys) return;

        var panX = 0, panZ = 0;
        if (this._panKeys.w) panZ -= this._panSpeed;
        if (this._panKeys.s) panZ += this._panSpeed;
        if (this._panKeys.a) panX -= this._panSpeed;
        if (this._panKeys.d) panX += this._panSpeed;

        if (panX !== 0 || panZ !== 0) {
            // Get camera's forward and right vectors projected onto XZ plane
            var forward = new THREE.Vector3();
            this.camera.getWorldDirection(forward);
            forward.y = 0;
            forward.normalize();

            var right = new THREE.Vector3();
            right.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

            // Calculate movement
            var move = new THREE.Vector3();
            move.addScaledVector(forward, -panZ);
            move.addScaledVector(right, panX);

            // Apply to both camera and target
            this.camera.position.add(move);
            this.controls.target.add(move);
        }

        // Q/E keyboard zoom
        if (this._panKeys.q || this._panKeys.e) {
            var zoomDir = this._panKeys.e ? -1 : 1; // E = zoom in, Q = zoom out
            var direction = new THREE.Vector3();
            direction.subVectors(this.camera.position, this.controls.target).normalize();

            var distance = this.camera.position.distanceTo(this.controls.target);
            var zoomAmount = this._zoomSpeed * zoomDir;

            // Respect min/max distance
            var newDistance = distance + zoomAmount;
            if (newDistance >= this.controls.minDistance && newDistance <= this.controls.maxDistance) {
                this.camera.position.addScaledVector(direction, zoomAmount);
            }
        }
    },

    /* click → find which timeline + square (or history square) */
    _onClick: function (event) {
        var rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        this.raycaster.setFromCamera(this.mouse, this.camera);

        // Collect all clickable squares across all timelines
        var allMeshes = [];
        for (var key in this.timelineCols) {
            allMeshes = allMeshes.concat(this.timelineCols[key].getAllSquareMeshes());
        }
        var hits = this.raycaster.intersectObjects(allMeshes);
        if (hits.length > 0 && this.onSquareClick) {
            var ud = hits[0].object.userData;
            this.onSquareClick({
                timelineId: ud.timelineId,
                square: ud.square,
                turn: ud.turn,
                isHistory: !!ud.isHistory
            });
        }
    },

    _onResize: function () {
        var w = this.container.clientWidth, h = this.container.clientHeight;
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h);
    },

    _animate: function () {
        var self = this;
        requestAnimationFrame(function () { self._animate(); });
        var t = this._clock.getElapsedTime();

        // Update WASD panning
        this._updatePanning();

        // Update focus animation
        this._updateFocusAnimation();

        this.controls.update();

        if (this.particleSystem) {
            var pa = this.particleSystem.geometry.attributes.position.array;
            for (var i = 1; i < pa.length; i += 3) pa[i] += Math.sin(t * 0.5 + i) * 0.001;
            this.particleSystem.geometry.attributes.position.needsUpdate = true;
            this.particleSystem.rotation.y = t * 0.006;
        }

        // Pulse branch lines
        var pulse = 0.7 + 0.3 * Math.sin(t * 2);
        this.branchLineGroup.traverse(function (child) {
            if (child.isMesh && child.material && child.material.opacity <= 0.12) {
                child.material.opacity = 0.1 * pulse;
            }
        });

        // Pulse inter-layer lines per timeline
        for (var key in this.timelineCols) {
            this.timelineCols[key].interLayerGroup.traverse(function (child) {
                if (child.isMesh && child.material && child.material.opacity <= 0.12) {
                    child.material.opacity = 0.1 * pulse;
                }
            });
        }

        this.renderer.render(this.scene, this.camera);
    },

    clearAll: function () {
        for (var key in this.timelineCols) {
            this.timelineCols[key].destroy();
        }
        this.timelineCols = {};
        while (this.branchLineGroup.children.length) this.branchLineGroup.remove(this.branchLineGroup.children[0]);
        this.controls.target.set(0, 0, 0);
    }
};
