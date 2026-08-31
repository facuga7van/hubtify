#!/usr/bin/env bash
#
# cleanup-disk.sh — reclaim ~4.7 GB of build/model residue from the working copy.
#
# EVERY DELETION BELOW IS COMMENTED OUT ON PURPOSE. Read the notes, uncomment
# what you actually want gone, then run it. Nothing here is in git history
# (verified: `git log --all -- "*.gguf"` is empty, `.git` is a healthy 27 MB),
# so removing these is a plain filesystem delete — no history rewrite, no
# force-push, but also NO WAY BACK from this repo. Re-download or rebuild only.
#
#   Usage:  bash scripts/cleanup-disk.sh
#
set -euo pipefail
cd "$(dirname "$0")/.."
echo "repo: $(pwd)"

# ─────────────────────────────────────────────────────────────────────────────
# 1. Abandoned Ollama models — 2.64 GB total
# ─────────────────────────────────────────────────────────────────────────────
# Nutrify moved off Ollama to the Gemini API (see changelog.ts:503). Nothing in
# src/, electron/, shared/, tests/ or functions/ references `ollama`, `gguf`, or
# `nutrify-q8` any more — the changelog line is the only surviving mention.
# Both files are gitignored (`*.gguf`) and untracked.
#
# NOT RECOVERABLE from this repo. Only re-quantize/re-download if you ever want
# the local-model path back.
#
#   nutrify-q8.gguf ............................ 1.32 GB (repo root)
#   electron/modules/nutrition/model/nutrify.gguf 1.32 GB (exact duplicate)
#
# rm -f nutrify-q8.gguf
# rm -f electron/modules/nutrition/model/nutrify.gguf
#
# The Modelfile beside it (245 B) is the Ollama recipe for that gguf. It was
# tracked in git despite matching the `Modelfile` gitignore entry; it has been
# untracked with `git rm --cached`. Delete it too if you kill the model:
#
# rm -f electron/modules/nutrition/model/Modelfile
# rmdir electron/modules/nutrition/model 2>/dev/null || true

# ─────────────────────────────────────────────────────────────────────────────
# 2. Orphaned git worktree — 1.1 GB
# ─────────────────────────────────────────────────────────────────────────────
# `.worktrees/coinify-v2` does NOT appear in `git worktree list` (only
# D:/code/hubtify [master] does), so git has already forgotten it. It is a stale
# checkout carrying its own node_modules. Gitignored.
#
# Before deleting, make sure it holds no uncommitted work you still want:
#   git -C .worktrees/coinify-v2 status
#   git -C .worktrees/coinify-v2 log --oneline -5
#
# rm -rf .worktrees/coinify-v2
# git worktree prune   # harmless; clears any leftover admin files

# ─────────────────────────────────────────────────────────────────────────────
# 3. Packaged build output — 952 MB
# ─────────────────────────────────────────────────────────────────────────────
# Fully regenerable with `npm run make`. Gitignored.
#
# rm -rf out

# ─────────────────────────────────────────────────────────────────────────────
# ALREADY DONE (no action needed — listed so the accounting adds up)
# ─────────────────────────────────────────────────────────────────────────────
#   dist/       11 MB   flat Vite build from 5 months ago. Electron Forge builds
#                       into .vite/build/, never dist/. Deleted.
#   Modelfile   54 B    repo root, `FROM ./nutrify-q8.gguf`. Untracked, no
#                       references anywhere. Deleted.
#
# You may also want `.vite/` (Forge's dev/build cache) — it regenerates on the
# next `npm start` / `npm run make`:
#
# rm -rf .vite

echo
echo "Nothing was deleted: every command in this script is commented out."
echo "Uncomment the blocks you want and re-run."
