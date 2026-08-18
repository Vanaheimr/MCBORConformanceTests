#!/usr/bin/env sh
# Runs the full Metrological CBOR conformance suite:
# both runners, cross-feeds, judgement, and results/report.md.
cd "$(dirname "$0")" && exec node compare/run.mjs "$@"
