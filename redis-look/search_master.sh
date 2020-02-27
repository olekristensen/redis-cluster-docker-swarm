#!/bin/sh

until [ "$(redis-cli -h $REDIS_SENTINEL_IP -p $REDIS_SENTINEL_PORT ping)" = "PONG" ]; do
	echo "$REDIS_SENTINEL_IP is unavailable - sleeping"
	exit 1
done

master_info=$(redis-cli -h $REDIS_SENTINEL_IP -p $REDIS_SENTINEL_PORT sentinel get-master-addr-by-name $REDIS_MASTER_NAME)

if [ "$master_info" ]; then
  echo $master_info
else
  exit 1
fi
