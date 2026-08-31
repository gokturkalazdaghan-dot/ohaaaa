---
name: codex
description: Runs OpenAI Codex as a hands-on builder from inside Claude Code, on the Rocket Fuel system. Claude is the Visionary (plans, sets standards, reviews every line). Codex is the Integrator (critiques the plan, writes code in its own sandbox, reports). Use when the user says /codex, wants to build or refactor with Codex, or wants a plan pressure-tested by a second model. Hardened wrapper over the rocket-fuel engine.
---

# /codex — Claude plans and reviews, Codex builds

Read these three engine files IN ORDER and apply them exactly:
1. ~/rocket-fuel-skill/rocket-fuel/SKILL.md
2. ~/rocket-fuel-skill/rocket-fuel/SAME-PAGE-MEETING.md
3. ~/rocket-fuel-skill/rocket-fuel/CODEX-INTEGRATOR.md

Everywhere they say /rocket-fuel, here it means /codex. Update the engine with: git -C ~/rocket-fuel-skill pull

Drive from the main session; run each Codex call in the FOREGROUND (blocking Bash, 10-min timeout) and read the -o file when it returns. Do not delegate the whole run to a sub-agent.

HARDENED RULES (apply on top of the engine):
- Show the work: before each Codex call say what you run; after each round relay Codex's findings to the user in plain language.
- Trust nothing Codex reports. Read the FULL diff, not its summary. Run the proof yourself. Write your OWN adversarial test with cases its suite missed (empty/broken input, boundaries, unicode, first real run) and run it. For subtle work, have a fresh reviewer that has not seen your reasoning try to break it. A build passes only when the proof passes when YOU run it.
- Messy repo? Run the WHOLE flow in a git worktree: git worktree add -b codex-<task> <temp> HEAD gives a clean checkout while the main tree keeps its uncommitted work. Do the whole run there (write, baseline-commit, review, build, review), not just the build. Fresh/empty project needs no worktree.
- Teardown order: FIRST move the result to main if keeping it (cherry-pick/merge), THEN worktree remove --force + branch -D. Never remove before moving, or the work is lost.
- Single scoped task (BUILD A ROCK) has no Same Page Meeting; the contract is the agreement. Result goes to main by default. Put artifacts next to the code.
- Model/effort is an informed choice: stronger model + higher effort = better code but faster limit burn. Top model for hard logic, lighter for routine. Set in ~/.codex/config.toml; never pin -m on ChatGPT auth. New-model 400 error: run codex update (not npm).
- A call succeeded only if exit 0 AND -o file non-empty AND (meetings) last line has VERDICT:. If auth breaks, run codex login.

Based on Rocket Fuel by Gino Wickman & Mark C. Winters, and the rocket-fuel skill by NulightJens (MIT).
