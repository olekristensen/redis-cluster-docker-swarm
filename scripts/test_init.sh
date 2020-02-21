#!/bin/bash

set -e

ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." >/dev/null 2>&1 && pwd )"

echo "Starting init tests"
cat  "${ROOT}/scripts/check_scaling.sh" | docker exec -i $(docker ps --filter name=redis-sentinel -q) /bin/sh
