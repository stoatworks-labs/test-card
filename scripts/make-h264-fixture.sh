#!/usr/bin/env bash
# Regenerate test/fixtures/h264-64x48.h264, the stream mp4.test.ts muxes.
#
# A real encoder's output, not a hand-made byte string: libx264, Main profile,
# no B-frames (the MP4 writer does not do reordering, and neither does the
# browser encoder it stands in for), an access-unit delimiter before every
# frame so the test can split the stream without a full H.264 parser, and a
# keyframe every 5 frames so the sync-sample table has something to say.
#
#   scripts/make-h264-fixture.sh
set -euo pipefail
cd "$(dirname "$0")/.."
ffmpeg -v error -y -f lavfi -i "testsrc2=size=64x48:rate=10" -t 2 \
  -c:v libx264 -profile:v main -pix_fmt yuv420p -bf 0 -g 5 -keyint_min 5 -sc_threshold 0 \
  -x264-params aud=1:colorprim=bt709:transfer=bt709:colormatrix=bt709 \
  -f h264 test/fixtures/h264-64x48.h264
ls -l test/fixtures/h264-64x48.h264
