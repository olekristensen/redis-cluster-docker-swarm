#!/bin/sh
REDIS_SENTINEL_IP=${REDIS_SENTINEL_IP:-redis-sentinel}
REDIS_SENTINEL_PORT=${REDIS_SENTINEL_PORT:-26379}
until [ "$(redis-cli -h $REDIS_SENTINEL_IP -p $REDIS_SENTINEL_PORT ping)" = "PONG" ]; do
	echo "$REDIS_SENTINEL_IP is unavailable - sleeping"
	sleep 1
done

master_info=$(redis-cli -h $REDIS_SENTINEL_IP -p $REDIS_SENTINEL_PORT sentinel get-master-addr-by-name $REDIS_MASTER_NAME)

if [ "$master_info" ]; then
  HOST=$(echo $master_info | cut -f 1 -d" ")
  PORT=$(echo $master_info | cut -f 2 -d" ")
  redis-cli -h $HOST -p $PORT $*
else
  echo "Can't find master"
  exit 1
fi
