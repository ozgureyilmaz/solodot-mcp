#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PACKAGE_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)

IMAGE=${SOLODOT_MCP_IMAGE:-solodot-mcp:local}
NAME=${SOLODOT_MCP_CONTAINER_NAME:-solodot-mcp}
PORT=${SOLODOT_MCP_PORT:-8787}
ENV_FILE=${SOLODOT_MCP_ENV_FILE:-$PACKAGE_DIR/.env}

require_container() {
  if ! command -v container >/dev/null 2>&1; then
    echo "apple container is not installed. see https://github.com/apple/container/releases" >&2
    exit 1
  fi
}

case "${1:-}" in
  build)
    require_container
    exec container build \
      --file "$PACKAGE_DIR/Dockerfile" \
      --tag "$IMAGE" \
      "$PACKAGE_DIR"
    ;;
  run)
    require_container
    if [ ! -f "$ENV_FILE" ]; then
      echo "missing env file: $ENV_FILE" >&2
      echo "copy $PACKAGE_DIR/.env.example to $PACKAGE_DIR/.env and add your secrets" >&2
      exit 1
    fi
    exec container run \
      --detach \
      --rm \
      --init \
      --name "$NAME" \
      --env-file "$ENV_FILE" \
      --publish "127.0.0.1:$PORT:8787" \
      "$IMAGE"
    ;;
  health)
    exec curl --fail --silent --show-error "http://127.0.0.1:$PORT/health"
    ;;
  logs)
    require_container
    exec container logs "$NAME"
    ;;
  stop)
    require_container
    exec container stop "$NAME"
    ;;
  *)
    echo "usage: $0 {build|run|health|logs|stop}" >&2
    exit 2
    ;;
esac
