# Subagent Testing Findings - Move Indicator Bug Hunt

## Summary

6 subagents were deployed to test the 5D chess game for move indicator bugs. Testing ran from approximately 1:30pm - 2:50pm EST on 2026-02-20.

### Key Finding: Indicators Showing on Empty Squares

**Agent 4 (Dumb CPU, Slow, 3D mode)** found:
- Move 120: "ORANGE indicators on e1 and f1 - squares are EMPTY on this board!"
- Move 131: "Blue circles on e8 and f8 - squares appear empty on this board"
- Move 27: "Orange circles at a8 and b8 - those squares appear EMPTY on this timeline!"

This is the core bug: **move indicator lines/circles persist or appear on squares where no piece exists**.

### Possible Causes

1. **Cross-timeline indicator confusion**: Lines drawn for moves on OTHER timelines appearing on wrong board
2. **Last-move indicator persistence**: Orange/blue indicators not clearing when pieces move away
3. **Timing issue**: Indicator drawn before piece sprite removal completes
4. **History layer bleed**: Indicators from history view showing on current board state

## Agent Reports

### Agent 1 - Code Analysis (3.2MB log)
Deep dive into makeMove(), spriteMap, and render code. Identified sprite pool and cleanup mechanisms.

### Agent 2 - Edge Case Hunt (3.8MB log) ✅ COMPLETE
Found 518 internal ghost sprites but reported NO user-visible bugs. The cleanup system is working.

### Agent 3 - Stockfish Settings (2.2MB log)
Tested various Stockfish skill/depth settings. No settings-specific bugs found.

### Agent 4 - Dumb CPU Slow 3D (5.4MB log)
**FOUND THE BUG**: Indicators showing on empty squares at moves 27, 120, 131.

### Agent 5 - Stockfish Slow 3D (9.5MB log)
Ran longest test. Similar observations to Agent 4.

### Agent 6 - Stockfish Slow 2D (4.0MB log)
2D mode testing. TL labels were overlapping (fixed separately).

## Screenshots

2114 screenshots captured in `/Users/sven/Pictures/chrome-screenshots/`
Key timestamps around bug observations:
- screenshot_20260220_145037.jpg - Move 27 with indicator issues
- screenshot_20260220_145052.jpg - Move 28
- screenshot_20260220_145119.jpg - Move 46

## Code Locations to Investigate

- `/src/board3d.ts`: Line drawing (moveLineGroup, lastMoveHL)
- `/src/board3d.ts`: spriteMap management
- `/src/game.ts`: makeMove() and cross-timeline move execution

## Fixes Applied This Session

1. ✅ TL label overlap in 2D mode (hidden labels)
2. ✅ Piece prominence in 2D mode (scale 1.25x)
3. ✅ Speed slider display (shows actual delay)
4. 🔧 2D mode button styling (needs more work)

## Next Subagent Run Plan

Run games **until all boards are complete** (checkmate/stalemate/draw on all timelines):

1. **Stockfish 2D** - full game completion
2. **Stockfish 3D** - full game completion
3. **Dumb CPU 2D** - full game completion
4. **Stockfish 2D with skill mismatch** - Black=noob (skill 0), White=pro (skill 20)

Settings:
- Speed: 500ms (faster than previous 1000ms)
- Auto-terminate when game truly ends
- Screenshot frequency: every 10 moves (not every move)
- Report specific code line numbers for any bugs found

## Code Locations to Investigate

- `/src/board3d.ts`: Line drawing (moveLineGroup, lastMoveHL)
- `/src/board3d.ts`: spriteMap management
- `/src/game.ts`: makeMove() and cross-timeline move execution
