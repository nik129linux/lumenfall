#!/usr/bin/env bash
# Autonomous bunny loop: resumes the same opencode session until .bunny-done exists.
SES=ses_f16830083ffedaYGrGnC2MUEby
MSG='Continue building LUMENFALL autonomously. Never ask questions, decide yourself and note decisions in docs/. Never use /tmp or paths outside this folder, put scratch files in .scratch/. Commit to git after each working milestone. When everything in the spec is built, the game loads with no console errors (verify with a static server + headless check if available), and README.md has run instructions + controls, create an empty file .bunny-done and stop.'
for i in $(seq 1 8); do
  [ -f .bunny-done ] && { echo "== DONE after $((i-1)) rounds"; exit 0; }
  echo "== round $i $(date +%H:%M)"
  opencode run --auto -m opencode/space-bunny-free -s "$SES" "$MSG"
done
echo "== stopped at round cap, .bunny-done missing"
