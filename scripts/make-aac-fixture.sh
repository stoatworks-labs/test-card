#!/usr/bin/env bash
# Regenerate test/fixtures/aac-48k-stereo.aac, the sound mp4.test.ts muxes.
#
# A real encoder's output: ffmpeg's own AAC encoder (AAC-LC, 48 kHz, stereo),
# as ADTS so the test can split it into frames without an MP4 parser. Two
# seconds of sound, to match the H.264 fixture, with a 1 kHz beep starting at
# exactly 0.5 s and 1.5 s of it.
#
# In front of it, 256 samples of silence: ffmpeg's encoder primes 1024 samples,
# and 1024 + 256 + 96000 is exactly 95 AAC packets. That is what audio.ts's
# alignToPackets arranges for a real loop, so the file's edit list ends on a
# packet boundary and the test can loop it through ffmpeg and look for drift.
# The test skips 1024 + 256 = 1280 samples.
#
#   scripts/make-aac-fixture.sh
set -euo pipefail
cd "$(dirname "$0")/.."
ffmpeg -v error -y -f lavfi \
  -i "aevalsrc='0.126*sin(2*PI*1000*(t-256/48000))*(between(t-256/48000,0.5,0.5333)+between(t-256/48000,1.5,1.5333))':s=48000:d=3:c=stereo" -af atrim=end_sample=96256 \
  -c:a aac -b:a 128k -f adts test/fixtures/aac-48k-stereo.aac
ls -l test/fixtures/aac-48k-stereo.aac
