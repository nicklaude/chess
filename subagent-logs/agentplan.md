# Agent Analysis Plan: Move Indicator Bug Hunt

## Goal
Find orange/blue move indicator lines that point to empty squares (no piece) and cross-reference with logs to understand root cause.

## Data Sources

### Screenshots
- Location: `/Users/sven/Pictures/chrome-screenshots/`
- Count: 2114+ screenshots from subagent testing
- Format: `screenshot_YYYYMMDD_HHMMSS.jpg`
- Timeframe: 2026-02-20 afternoon testing session

### Subagent Logs
- Location: `~/code/chess/subagent-logs/`
- Files:
  - `agent1-code-analysis.md` - deep code review
  - `agent2-edge-case-hunt.md` - dumb CPU fast test (COMPLETE)
  - `agent3-stockfish-settings.md` - various stockfish configs
  - `agent4-dumb-slow-3d.md` - dumb CPU slow 3D (indicator focus)
  - `agent5-stockfish-slow-3d.md` - stockfish slow 3D (indicator focus)
  - `agent6-stockfish-slow-2d.md` - stockfish slow 2D (indicator focus)

## Analysis Steps

### Step 1: Identify Problem Screenshots
1. Review screenshots looking for:
   - Orange lines (last move) pointing to empty squares
   - Blue lines (move path) not connecting to actual piece
   - Lines with no piece at either endpoint

2. Note timestamp of problematic screenshots

### Step 2: Cross-Reference with Logs
1. Find corresponding log entries by timestamp
2. Look for:
   - `makeMove()` calls around that time
   - spriteMap state logs
   - Ghost piece detection warnings
   - Render cycle logs

### Step 3: Analyze Code Path
Key code locations in `/Users/sven/code/chess/src/board3d.ts`:
- Line drawing: search for `moveLineGroup`, `lastMoveHL`
- Sprite management: `_spriteMap`, `spritePool`
- Render cycle: `render()` method
- Move execution: `makeMove()` in game.ts

### Step 4: Identify Pattern
- Does bug happen more with Stockfish vs dumb CPU?
- Does it happen more in 2D vs 3D mode?
- Is it related to cross-timeline moves?
- Is it a timing issue (animation vs state update)?

## Bug Hypothesis (to investigate)
1. **Timing Issue**: Line drawn before piece sprite created
2. **spriteMap Desync**: Map says piece at X but sprite is at Y
3. **Cross-Timeline**: Purple lines miscalculate target board
4. **History Layer**: Line points to old position from history view

## Commands for Analysis

```bash
# Find screenshots from specific time window
ls -la /Users/sven/Pictures/chrome-screenshots/screenshot_20260220_14*.jpg

# Search logs for specific move or error
grep -i "ghost\|error\|mismatch" ~/code/chess/subagent-logs/*.md

# Find screenshots taken around errors
# (cross-reference timestamps)
```

## Next Steps After Agents Complete
1. Review all agent final reports
2. Manually examine flagged screenshots
3. Deep dive into any bugs found
4. Create fix PR if root cause identified
