#!/usr/bin/env bash
# Regenerate test/fixtures/aac-48k-stereo.aac, the sound mp4.test.ts muxes.
#
# A real encoder's output: ffmpeg's own AAC encoder (AAC-LC, 48 kHz, stereo),
# as ADTS so the test can split it into frames without an MP4 parser. Two
# seconds, to match the H.264 fixture, with a 1 kHz beep starting at exactly
# 0.5 s and 1.5 s. ffmpeg's encoder primes 1024 samples (Chrome's, on a Mac,
# 2112), so the test can check that the edit list skips the priming: decoded
# from the MP4, the beeps must start where they were put.
#
#   scripts/make-aac-fixture.sh
set -euo pipefail
cd "$(dirname "$0")/.."
ffmpeg -v error -y -f lavfi -i "aevalsrc='0.126*sin(2*PI*1000*t)*(between(t,0.5,0.5333)+between(t,1.5,1.5333))':s=48000:d=2:c=stereo" \
  -c:a aac -b:a 128k -f adts test/fixtures/aac-48k-stereo.aac
ls -l test/fixtures/aac-48k-stereo.aac
