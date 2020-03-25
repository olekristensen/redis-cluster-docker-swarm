#!/bin/sh
STACK=${1:-test}
REDIS_MASTER_NAME=${REDIS_MASTER_NAME:-redismaster}
docker run -it --net ${STACK}_redisnet  --env REDIS_MASTER_NAME=${REDIS_MASTER_NAME} \
	destinationbook/redis-look:${TAG:-latest} /redis/redis-cli.sh $*
