#!/bin/bash

set -e

TAG=${1:-"latest"}

ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." >/dev/null 2>&1 && pwd )"

for image in "redis-look" "redis-sentinel" "redis-utils"; do
	echo "Building $image"
	docker build -t docker.io/olekristensen/${image}:${TAG} "${ROOT}/${image}"
	docker push docker.io/olekristensen/${image}:${TAG} &
done

wait
