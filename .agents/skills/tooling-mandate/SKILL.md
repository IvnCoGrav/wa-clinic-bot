---
name: tooling-mandate
description: >
  Enforces maximum use of the three core efficiency tools: graphify (codebase graph
  navigation), rtk (token-optimized CLI proxy), and caveman (compressed communication mode).
  Auto-triggers at session start and whenever any of these tools would be applicable.
  Also triggers on: "use tools", "maximize tools", "tooling mandate", "all tools active".
---

# Tooling Mandate — graphify + rtk + caveman

Three tools ALWAYS active. No exceptions unless user explicitly disables one.

## 1. RTK (Rust Token Killer)

**When**: Every shell command. Always prefix with `rtk`.

```bash
# ALWAYS
rtk git status
rtk git log -n 10
rtk npm test
rtk cargo build
rtk grep "pattern" src/
rtk find . -name "*.ts"

# Meta
rtk gain              # Check token savings
rtk gain --history    # History with savings
rtk discover          # Find missed RTK opportunities
```

**Why**: 60-90% token reduction on CLI output. Never run raw commands.

---

## 2. Caveman Mode

**When**: Default communication style. All prose responses use caveman compression.

**Default level**: `full` — drop articles, fragments OK, short synonyms, no filler.

**Rules** (from caveman skill):
- Drop: articles, filler words, pleasantries, hedging
- Keep: all technical substance, exact error strings, code blocks unchanged
- Fragments OK. Pattern: `[thing] [action] [reason]. [next step].`
- Preserve user language (Indonesian → Indonesian caveman)
- No self-reference, no "caveman mode on" announcements

**Disable**: "stop caveman" / "normal mode"

---

## 3. Graphify (Codebase Graph Navigation)

**When**: Any codebase investigation, feature tracing, dependency analysis, "where is X", "how does Y work".

**Core commands**:
```bash
# Build graph for current repo
graphify build

# Find shortest path between two nodes
graphify path "ComponentA" "ServiceB"

# Explain a node and its neighbors
graphify explain "functionName"

# Diagnose graph issues
graphify diagnose multigraph

# Install skill to other AI platforms
graphify install --platform antigravity
graphify install --platform claude
graphify install --platform cursor
```

**Workflow**:
1. `graphify build` → generate graphify-out/graph.json
2. `graphify explain "entrypoint"` → understand topology
3. `graphify path "source" "target"` → trace call paths
4. Use graph data instead of blind grep/file crawling

**Why**: Replaces blind grep + file crawling. Structured graph = fewer tokens, faster answers.

---

## Priority Order

When all three applicable simultaneously:
1. **RTK first** — wrap command
2. **Graphify** — use graph instead of grep/explore when investigating code
3. **Caveman** — compress the response

---

## Session Checklist

At session start or when working on new task:
- caveman mode active (full, default)
- rtk prefix on all shell commands
- graphify build if investigating unfamiliar codebase

---

## Install to All Platforms

Run once to propagate graphify skill to all AI platforms:
```bash
graphify install --platform antigravity
graphify install --platform claude
graphify install --platform cursor
graphify install --platform codex
graphify install --platform opencode
graphify install --platform aider
graphify install --platform amp
graphify install --platform kiro
```
