#!/usr/bin/env bash
# build-docker.sh — Build (and optionally push) Webspinner Docker image to GHCR
# Usage:
#   ./build-docker.sh [--push] [--tag <vX.Y.Z|latest>] [--deno <2.x.y>] [--platforms <list>]
# Defaults: --tag from git tag if present else latest; --deno from deployment/.deno-version; --platforms linux/amd64,linux/arm64

set -euo pipefail

IMAGE="ghcr.io/spintheweb/webspinner"
PUSH=false
TAG=""
DENO_VER=""
PLATFORMS="linux/amd64,linux/arm64"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --push) PUSH=true ;;
    --tag) TAG="$2"; shift ;;
    --deno) DENO_VER="$2"; shift ;;
    --platforms) PLATFORMS="$2"; shift ;;
    -h|--help)
      echo "Usage: $0 [--push] [--tag <vX.Y.Z|latest>] [--deno <2.x.y>] [--platforms <list>]"; exit 0 ;;
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

# Determine Deno version
if [[ -z "$DENO_VER" ]]; then
  if [[ -f "$(dirname "$0")/.deno-version" ]]; then
    DENO_VER="$(cat "$(dirname "$0")/.deno-version")"
  elif [[ -f .deno-version ]]; then
    DENO_VER="$(cat .deno-version)"
  else
    DENO_VER="2.3.0"
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
  --build-arg "DENO_VERSION=$DENO_VER"
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
