#!/bin/bash

set -e

TAG=${1:-"latest"}

ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." >/dev/null 2>&1 && pwd )"

for image in "redis-look" "redis-sentinel" "redis-utils"; do
	echo "Building $image"
	docker build -t destinationbook/${image}:${TAG} "${ROOT}/${image}"
	docker push destinationbook/${image}:${TAG} &
done

wait
