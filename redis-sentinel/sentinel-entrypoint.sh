#!/bin/sh

sed -i "s/{{ SENTINEL_QUORUM }}/$SENTINEL_QUORUM/g" /redis/sentinel.conf
sed -i "s/{{ SENTINEL_DOWN_AFTER }}/$SENTINEL_DOWN_AFTER/g" /redis/sentinel.conf
sed -i "s/{{ SENTINEL_FAILOVER }}/$SENTINEL_FAILOVER/g" /redis/sentinel.conf
sed -i "s/{{ REDIS_MASTER_NAME }}/$REDIS_MASTER_NAME/g" /redis/sentinel.conf

until [ "$REDIS_IP" ]; do
  redis_ips=$(drill "$REDIS_SERVICE_NAME" | grep "$REDIS_SERVICE_NAME" | awk '{ if ($5) print $5 }')

  for ip in $redis_ips; do
      if redis-cli -h "${ip}" INFO | grep -q 'role:master'; then
          REDIS_IP="${ip}"
          break
      fi
  done

  if [ ! "${REDIS_IP}" ]; then
    echo "Can't find master, sleeping and retrying."
    sleep 1
  fi
done

sed -i "s/{{ REDIS_IP }}/$REDIS_IP/g" /redis/sentinel.conf
redis-server /redis/sentinel.conf --sentinel
