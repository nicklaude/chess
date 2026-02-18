/**
 * Unit tests for 6D Chess game utilities
 * Tests FEN manipulation, validation, and core game logic
 */

const Chess = require('chess.js').Chess;

// Import the utilities we're testing (these will be transpiled by ts-node)
// For now, we'll duplicate the logic here for standalone testing

// ===============================================================
// FEN Utility Functions (duplicated for testing)
// ===============================================================

function expandFenRow(row: string): string[] {
  const result: string[] = [];
  for (const char of row) {
    if (char >= '1' && char <= '8') {
      for (let i = 0; i < parseInt(char); i++) result.push('');
    } else {
      result.push(char);
    }
  }
  return result;
}

function compressFenRow(arr: string[]): string {
  let result = '';
  let emptyCount = 0;
  for (const char of arr) {
    if (char === '') {
      emptyCount++;
    } else {
      if (emptyCount > 0) {
        result += emptyCount;
        emptyCount = 0;
      }
      result += char;
    }
  }
  if (emptyCount > 0) result += emptyCount;
  return result;
}

function squareToIndices(sq: string): { r: number; c: number } {
  return { r: 8 - parseInt(sq[1]), c: sq.charCodeAt(0) - 97 };
}

function indicesToSquare(r: number, c: number): string {
  return String.fromCharCode(97 + c) + (8 - r);
}

interface FenParts {
  position: string;
  turn: 'w' | 'b';
  castling: string;
  enPassant: string;
  halfmoveClock: number;
  fullmoveNumber: number;
}

function parseFen(fen: string): FenParts {
  const parts = fen.split(' ');
  return {
    position: parts[0],
    turn: (parts[1] || 'w') as 'w' | 'b',
    castling: parts[2] || '-',
    enPassant: parts[3] || '-',
    halfmoveClock: parseInt(parts[4]) || 0,
    fullmoveNumber: parseInt(parts[5]) || 1,
  };
}

function buildFen(parts: FenParts): string {
  return `${parts.position} ${parts.turn} ${parts.castling} ${parts.halfmoveClock} ${parts.fullmoveNumber}`;
}

function updateCastlingForRemoval(
  castling: string,
  square: string,
  removedPieceChar: string
): string {
  if (castling === '-') return '-';

  const removedPiece = removedPieceChar.toLowerCase();
  const isWhitePiece = removedPieceChar === removedPieceChar.toUpperCase();

  if (removedPiece === 'k') {
    castling = isWhitePiece ? castling.replace(/[KQ]/g, '') : castling.replace(/[kq]/g, '');
  } else if (removedPiece === 'r') {
    if (square === 'a1') castling = castling.replace('Q', '');
    else if (square === 'h1') castling = castling.replace('K', '');
    else if (square === 'a8') castling = castling.replace('q', '');
    else if (square === 'h8') castling = castling.replace('k', '');
  }

  return castling === '' ? '-' : castling;
}

function updateCastlingForPlacement(castling: string, square: string): string {
  if (castling === '-') return '-';

  if (square === 'a1') castling = castling.replace('Q', '');
  else if (square === 'h1') castling = castling.replace('K', '');
  else if (square === 'a8') castling = castling.replace('q', '');
  else if (square === 'h8') castling = castling.replace('k', '');

  return castling === '' ? '-' : castling;
}

interface Piece {
  type: 'k' | 'q' | 'r' | 'b' | 'n' | 'p';
  color: 'w' | 'b';
}

interface ModifyFenOptions {
  fen: string;
  square: string;
  newPiece: Piece | null;
  whiteToMove: boolean;
  isCapture?: boolean;
  resetEnPassant?: boolean;
}

function modifyFen(options: ModifyFenOptions): string {
  const { fen, square, newPiece, whiteToMove, isCapture = false, resetEnPassant = true } = options;

  const parts = fen.split(' ');
  const rows = parts[0].split('/');
  const pos = squareToIndices(square);

  if (!rows[pos.r]) {
    return fen;
  }

  const rowArr = expandFenRow(rows[pos.r]);
  const oldPieceChar = rowArr[pos.c];

  if (newPiece) {
    const pieceChar = newPiece.color === 'w'
      ? newPiece.type.toUpperCase()
      : newPiece.type.toLowerCase();
    rowArr[pos.c] = pieceChar;
  } else {
    rowArr[pos.c] = '';
  }
  rows[pos.r] = compressFenRow(rowArr);

  parts[0] = rows.join('/');
  parts[1] = whiteToMove ? 'w' : 'b';

  // Update castling rights
  let castling = parts[2] || '-';
  if (castling !== '-') {
    if (!newPiece && oldPieceChar) {
      castling = updateCastlingForRemoval(castling, square, oldPieceChar);
    }
    if (newPiece) {
      castling = updateCastlingForPlacement(castling, square);
    }
  }
  parts[2] = castling;

  // Reset en passant
  if (resetEnPassant) {
    parts[3] = '-';
  }

  // Halfmove clock
  const isPawnMove = newPiece && newPiece.type === 'p';
  if (isCapture || isPawnMove) {
    parts[4] = '0';
  } else {
    parts[4] = String(parseInt(parts[4] || '0') + 1);
  }

  // Fullmove number
  if (whiteToMove) {
    parts[5] = String(parseInt(parts[5] || '1') + 1);
  }

  return parts.join(' ');
}

function isValidFen(fen: string): boolean {
  const parts = fen.split(' ');
  if (parts.length !== 6) return false;

  const [position, turn, castling, enPassant, halfmove, fullmove] = parts;

  const ranks = position.split('/');
  if (ranks.length !== 8) return false;

  for (const rank of ranks) {
    let count = 0;
    for (const char of rank) {
      if (char >= '1' && char <= '8') {
        count += parseInt(char);
      } else if ('kqrbnpKQRBNP'.includes(char)) {
        count++;
      } else {
        return false;
      }
    }
    if (count !== 8) return false;
  }

  if (turn !== 'w' && turn !== 'b') return false;
  if (!/^(-|[KQkq]+)$/.test(castling)) return false;
  if (enPassant !== '-' && !/^[a-h][36]$/.test(enPassant)) return false;
  if (isNaN(parseInt(halfmove)) || isNaN(parseInt(fullmove))) return false;

  return true;
}

function validateKings(fen: string): { valid: boolean; whiteKings: number; blackKings: number } {
  const position = fen.split(' ')[0];
  let whiteKings = 0;
  let blackKings = 0;

  for (const char of position) {
    if (char === 'K') whiteKings++;
    else if (char === 'k') blackKings++;
  }

  return {
    valid: whiteKings === 1 && blackKings === 1,
    whiteKings,
    blackKings,
  };
}

// ===============================================================
// Test Runner
// ===============================================================

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

class TestSuite {
  private results: TestResult[] = [];
  private currentTest: string = '';

  test(name: string, fn: () => void): void {
    this.currentTest = name;
    try {
      fn();
      this.results.push({ name, passed: true });
    } catch (e) {
      this.results.push({ name, passed: false, error: (e as Error).message });
    }
  }

  assertEqual<T>(actual: T, expected: T, message?: string): void {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(
        message || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
      );
    }
  }

  assertTrue(condition: boolean, message?: string): void {
    if (!condition) {
      throw new Error(message || 'Expected true, got false');
    }
  }

  assertFalse(condition: boolean, message?: string): void {
    if (condition) {
      throw new Error(message || 'Expected false, got true');
    }
  }

  report(): { passed: number; failed: number; total: number } {
    let passed = 0;
    let failed = 0;

    console.log('\n' + '='.repeat(60));
    console.log('Unit Test Results');
    console.log('='.repeat(60) + '\n');

    for (const result of this.results) {
      if (result.passed) {
        console.log(`  ✓ ${result.name}`);
        passed++;
      } else {
        console.log(`  ✗ ${result.name}`);
        console.log(`    Error: ${result.error}`);
        failed++;
      }
    }

    console.log('\n' + '-'.repeat(60));
    console.log(`Passed: ${passed}/${this.results.length}`);
    console.log(`Failed: ${failed}/${this.results.length}`);
    console.log('='.repeat(60) + '\n');

    return { passed, failed, total: this.results.length };
  }
}

// ===============================================================
// Unit Tests
// ===============================================================

const suite = new TestSuite();

// --- FEN Row Expansion/Compression ---

suite.test('expandFenRow: full row with all pieces', () => {
  const result = expandFenRow('rnbqkbnr');
  suite.assertEqual(result, ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r']);
});

suite.test('expandFenRow: row with empty squares', () => {
  const result = expandFenRow('r1bqk2r');
  suite.assertEqual(result, ['r', '', 'b', 'q', 'k', '', '', 'r']);
});

suite.test('expandFenRow: all empty squares', () => {
  const result = expandFenRow('8');
  suite.assertEqual(result, ['', '', '', '', '', '', '', '']);
});

suite.test('compressFenRow: full row', () => {
  const result = compressFenRow(['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r']);
  suite.assertEqual(result, 'rnbqkbnr');
});

suite.test('compressFenRow: row with empty squares', () => {
  const result = compressFenRow(['r', '', 'b', 'q', 'k', '', '', 'r']);
  suite.assertEqual(result, 'r1bqk2r');
});

suite.test('compressFenRow: all empty', () => {
  const result = compressFenRow(['', '', '', '', '', '', '', '']);
  suite.assertEqual(result, '8');
});

suite.test('roundtrip: expand then compress', () => {
  const original = 'r2qk2r';
  const expanded = expandFenRow(original);
  const compressed = compressFenRow(expanded);
  suite.assertEqual(compressed, original);
});

// --- Square Conversion ---

suite.test('squareToIndices: a8', () => {
  const result = squareToIndices('a8');
  suite.assertEqual(result, { r: 0, c: 0 });
});

suite.test('squareToIndices: h1', () => {
  const result = squareToIndices('h1');
  suite.assertEqual(result, { r: 7, c: 7 });
});

suite.test('squareToIndices: e4', () => {
  const result = squareToIndices('e4');
  suite.assertEqual(result, { r: 4, c: 4 });
});

suite.test('indicesToSquare: a8', () => {
  const result = indicesToSquare(0, 0);
  suite.assertEqual(result, 'a8');
});

suite.test('indicesToSquare: h1', () => {
  const result = indicesToSquare(7, 7);
  suite.assertEqual(result, 'h1');
});

// --- FEN Parsing ---

suite.test('parseFen: starting position', () => {
  const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const result = parseFen(fen);
  suite.assertEqual(result.turn, 'w');
  suite.assertEqual(result.castling, 'KQkq');
  suite.assertEqual(result.enPassant, '-');
  suite.assertEqual(result.halfmoveClock, 0);
  suite.assertEqual(result.fullmoveNumber, 1);
});

suite.test('parseFen: mid-game position', () => {
  const fen = 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 5';
  const result = parseFen(fen);
  suite.assertEqual(result.turn, 'w');
  suite.assertEqual(result.halfmoveClock, 4);
  suite.assertEqual(result.fullmoveNumber, 5);
});

// --- Castling Rights Updates ---

suite.test('updateCastlingForRemoval: remove white king', () => {
  const result = updateCastlingForRemoval('KQkq', 'e1', 'K');
  suite.assertEqual(result, 'kq');
});

suite.test('updateCastlingForRemoval: remove black king', () => {
  const result = updateCastlingForRemoval('KQkq', 'e8', 'k');
  suite.assertEqual(result, 'KQ');
});

suite.test('updateCastlingForRemoval: remove white queenside rook', () => {
  const result = updateCastlingForRemoval('KQkq', 'a1', 'R');
  suite.assertEqual(result, 'Kkq');
});

suite.test('updateCastlingForRemoval: remove white kingside rook', () => {
  const result = updateCastlingForRemoval('KQkq', 'h1', 'R');
  suite.assertEqual(result, 'Qkq');
});

suite.test('updateCastlingForRemoval: remove black queenside rook', () => {
  const result = updateCastlingForRemoval('KQkq', 'a8', 'r');
  suite.assertEqual(result, 'KQk');
});

suite.test('updateCastlingForRemoval: remove black kingside rook', () => {
  const result = updateCastlingForRemoval('KQkq', 'h8', 'r');
  suite.assertEqual(result, 'KQq');
});

suite.test('updateCastlingForRemoval: no castling rights', () => {
  const result = updateCastlingForRemoval('-', 'a1', 'R');
  suite.assertEqual(result, '-');
});

suite.test('updateCastlingForPlacement: place on a1', () => {
  const result = updateCastlingForPlacement('KQkq', 'a1');
  suite.assertEqual(result, 'Kkq');
});

suite.test('updateCastlingForPlacement: place on h8', () => {
  const result = updateCastlingForPlacement('KQkq', 'h8');
  suite.assertEqual(result, 'KQq');
});

// --- modifyFen ---

suite.test('modifyFen: remove piece from starting position', () => {
  const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const result = modifyFen({
    fen,
    square: 'e2',
    newPiece: null,
    whiteToMove: false,
    isCapture: false,
  });

  // Pawn removed from e2
  suite.assertTrue(result.includes('PPPP1PPP'));
  // Turn flipped to black
  suite.assertTrue(result.split(' ')[1] === 'b');
  // Halfmove clock incremented (not a capture)
  suite.assertEqual(result.split(' ')[4], '1');
});

suite.test('modifyFen: place piece with capture', () => {
  const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 5 10';
  const result = modifyFen({
    fen,
    square: 'd7',
    newPiece: { type: 'q', color: 'w' },
    whiteToMove: false,
    isCapture: true,
  });

  // Queen placed on d7
  suite.assertTrue(result.includes('pppQpppp'));
  // Halfmove clock reset on capture
  suite.assertEqual(result.split(' ')[4], '0');
});

suite.test('modifyFen: en passant reset', () => {
  const fen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
  const result = modifyFen({
    fen,
    square: 'e4',
    newPiece: null,
    whiteToMove: true,
    resetEnPassant: true,
  });

  // En passant should be reset
  suite.assertEqual(result.split(' ')[3], '-');
});

suite.test('modifyFen: castling rights update on rook removal', () => {
  const fen = 'r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1';
  const result = modifyFen({
    fen,
    square: 'h1',
    newPiece: null,
    whiteToMove: false,
  });

  // White kingside castling should be removed
  suite.assertEqual(result.split(' ')[2], 'Qkq');
});

suite.test('modifyFen: fullmove number increment on white turn', () => {
  const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1';
  const result = modifyFen({
    fen,
    square: 'e7',
    newPiece: null,
    whiteToMove: true,
  });

  // Fullmove number should increment
  suite.assertEqual(result.split(' ')[5], '2');
});

// --- FEN Validation ---

suite.test('isValidFen: starting position', () => {
  const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  suite.assertTrue(isValidFen(fen));
});

suite.test('isValidFen: invalid - wrong number of ranks', () => {
  const fen = 'rnbqkbnr/pppppppp/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  suite.assertFalse(isValidFen(fen));
});

suite.test('isValidFen: invalid - wrong squares in rank', () => {
  const fen = 'rnbqkbnr/ppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  suite.assertFalse(isValidFen(fen));
});

suite.test('isValidFen: invalid - wrong turn character', () => {
  const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR x KQkq - 0 1';
  suite.assertFalse(isValidFen(fen));
});

suite.test('isValidFen: invalid - bad castling', () => {
  const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w XYZ - 0 1';
  suite.assertFalse(isValidFen(fen));
});

// --- King Validation ---

suite.test('validateKings: valid - one king each', () => {
  const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const result = validateKings(fen);
  suite.assertTrue(result.valid);
  suite.assertEqual(result.whiteKings, 1);
  suite.assertEqual(result.blackKings, 1);
});

suite.test('validateKings: invalid - no white king', () => {
  const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQ1BNR w KQkq - 0 1';
  const result = validateKings(fen);
  suite.assertFalse(result.valid);
  suite.assertEqual(result.whiteKings, 0);
});

suite.test('validateKings: invalid - two black kings', () => {
  const fen = 'rnbkkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const result = validateKings(fen);
  suite.assertFalse(result.valid);
  suite.assertEqual(result.blackKings, 2);
});

// ===============================================================
// Integration Tests - Time Travel Logic
// ===============================================================

suite.test('integration: time travel FEN modification preserves valid state', () => {
  const chess = new Chess();
  chess.move('e4');
  chess.move('e5');
  chess.move('Nf3');

  const fen = chess.fen();

  // Simulate time travel: remove knight from f3
  const result = modifyFen({
    fen,
    square: 'f3',
    newPiece: null,
    whiteToMove: false,  // Opponent's turn after time travel
    isCapture: false,
  });

  // Validate the FEN is still valid
  suite.assertTrue(isValidFen(result));

  // Check that knight is gone
  const testChess = new Chess();
  const loaded = testChess.load(result);
  suite.assertTrue(loaded);
  suite.assertEqual(testChess.get('f3'), null);
});

suite.test('integration: cross-timeline move updates both timelines correctly', () => {
  // Simulate two timelines
  const timeline1 = new Chess();
  timeline1.move('e4');
  timeline1.move('e5');

  const timeline2 = new Chess();
  timeline2.move('d4');
  timeline2.move('d5');

  const fen1 = timeline1.fen();
  const fen2 = timeline2.fen();

  // Both should be white's turn
  suite.assertEqual(fen1.split(' ')[1], 'w');
  suite.assertEqual(fen2.split(' ')[1], 'w');

  // Simulate queen cross-timeline (if there were one)
  // For this test, we'll just verify the FEN modification logic
  // After cross-timeline move, both should flip to black's turn
  const newFen1 = modifyFen({
    fen: fen1,
    square: 'd1',  // Queen's starting square
    newPiece: null,
    whiteToMove: false,
  });

  const newFen2 = modifyFen({
    fen: fen2,
    square: 'd1',
    newPiece: { type: 'q', color: 'w' },
    whiteToMove: false,
  });

  suite.assertEqual(newFen1.split(' ')[1], 'b');
  suite.assertEqual(newFen2.split(' ')[1], 'b');
});

suite.test('integration: halfmove clock resets on capture', () => {
  const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 10 20';

  const result = modifyFen({
    fen,
    square: 'e7',
    newPiece: { type: 'q', color: 'w' },
    whiteToMove: false,
    isCapture: true,
  });

  suite.assertEqual(result.split(' ')[4], '0');
});

suite.test('integration: halfmove clock increments on non-capture', () => {
  const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 10 20';

  const result = modifyFen({
    fen,
    square: 'e4',
    newPiece: { type: 'q', color: 'w' },
    whiteToMove: false,
    isCapture: false,
  });

  suite.assertEqual(result.split(' ')[4], '11');
});

// ===============================================================
// Run Tests
// ===============================================================

const results = suite.report();

if (results.failed > 0) {
  process.exit(1);
}
