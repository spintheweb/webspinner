#!/usr/bin/env bash
# build-docker.sh — Build (and optionally push) Webspinner Docker image to GHCR
# Usage:
#   ./build-docker.sh [--push] [--tag <vX.Y.Z|latest>] [--node <major>] [--platforms <list>]
# Defaults: --tag from git tag if present else latest; --node 26; --platforms linux/amd64,linux/arm64

set -euo pipefail

IMAGE="ghcr.io/spintheweb/webspinner"
PUSH=false
TAG=""
NODE_VER="26"
PLATFORMS="linux/amd64,linux/arm64"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --push) PUSH=true ;;
    --tag) TAG="$2"; shift ;;
    --node) NODE_VER="$2"; shift ;;
    --platforms) PLATFORMS="$2"; shift ;;
    -h|--help)
      echo "Usage: $0 [--push] [--tag <vX.Y.Z|latest>] [--node <major>] [--platforms <list>]"; exit 0 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
  shift
done

# Determine tag from git if not provided
if [[ -z "$TAG" ]]; then
  if git describe --tags --exact-match >/dev/null 2>&1; then
    TAG="$(git describe --tags --exact-match)"
  else
    TAG="latest"
  fi
fi

# Ensure buildx is available
if ! docker buildx version >/dev/null 2>&1; then
  echo "docker buildx is required. Install Docker Buildx or Docker Desktop." >&2
  exit 1
fi

# Create and use a builder if none is active
if ! docker buildx inspect >/dev/null 2>&1; then
  docker buildx create --use --name webspinner_builder || true
fi

echo "Building image for platforms: $PLATFORMS"

BUILD_ARGS=(
  --platform "$PLATFORMS"
  -f deployment/Dockerfile
  --build-arg "NODE_VERSION=$NODE_VER"
  -t "$IMAGE:$TAG"
  -t "$IMAGE:latest"
  .
)

if [[ "$PUSH" == true ]]; then
  docker buildx build "${BUILD_ARGS[@]}" --push
else
  docker buildx build "${BUILD_ARGS[@]}" --load
fi

echo "Done. Built $IMAGE:$TAG"
