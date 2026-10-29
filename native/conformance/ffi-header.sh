#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
generator="${CBINDGEN:-target/header-tools/bin/cbindgen}"
if [[ "$("$generator" --version)" != "cbindgen 0.29.4" ]]; then
  echo "Expected cbindgen 0.29.4. Install with the command in the native guide." >&2
  exit 1
fi
mkdir -p target/generated include
"$generator" --quiet --only-target-dependencies --config crates/mesh-avatar-ffi/cbindgen.toml --crate mesh-avatar-ffi --output target/generated/mesh_avatar.h
"$generator" --quiet --config crates/mesh-avatar-ffi/cbindgen-render.toml crates/mesh-avatar-ffi/src/render.rs --output target/generated/mesh_avatar_render.h
case "${1:-}" in
  --check)
    diff -u include/mesh_avatar.h target/generated/mesh_avatar.h
    diff -u include/mesh_avatar_render.h target/generated/mesh_avatar_render.h ;;
  "")
    cp target/generated/mesh_avatar.h include/mesh_avatar.h
    cp target/generated/mesh_avatar_render.h include/mesh_avatar_render.h ;;
  *) echo "Usage: bash conformance/ffi-header.sh [--check]" >&2; exit 2 ;;
esac
