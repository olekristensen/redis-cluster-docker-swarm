#!/bin/bash

set -e

REDIS_SENTINEL_NAME="redis-sentinel"
REDIS_MASTER_NAME="redismaster"
export TAG=${1:-"latest"}

echo "Scale redis"
docker service scale cache_redis-sentinel=3

until [ "$(docker run --rm --network redis olekristensen/redis-utils:$TAG \
	$REDIS_SENTINEL_NAME $REDIS_MASTER_NAME value num-other-sentinels)" = "2" ]; do
	echo "Sentinels not set up yet - sleeping"
	sleep 2
done

docker service scale cache_redis=3

echo "Make sure the number of slaves are set"
docker run --rm --network redis olekristensen/redis-utils:$TAG \
	$REDIS_SENTINEL_NAME $REDIS_MASTER_NAME reset "num-slaves" 2

echo "Starting following tests"
docker run --rm --network redis --volumes-from scripts \
	redis:4.0.11-alpine sh /scripts/check_scaling.sh 2 2
