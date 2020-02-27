#!/bin/sh

for x in $(seq 5); do
  if /redis/search_master.sh ; then
    # A master is already here. Nothing to do.
    exit 0
  fi
  sleep 1
done

echo "No redis master found, starting one in background."
redis-server &

# the following command tries to connect to the 1st slave
# and verifies that replication is done.
until redis-cli -h "$(redis-cli info | grep slave0 | sed 's#.*ip=\(.*\),port.*#\1#')" info | grep -q "master_sync_in_progress:0" ; do
  sleep 1
done

echo "replication done, trying to connect to sentinel..."

# make sure sentinel is up
while [ "$(redis-cli -h $REDIS_SENTINEL_IP -p $REDIS_SENTINEL_PORT sentinel master $REDIS_MASTER_NAME | grep -A1 "num-slaves" | tail -n1)" -lt "$SENTINEL_QUORUM" ] ; do
  sleep 1
done
master=$(/redis/search_master.sh)

echo "master is replicated and sentinel is up. shuting down bootstart server."
redis-cli shutdown

# let the failover happen.
echo "Waiting until the new master comes up..."
while [ "${master}" == "$(/redis/search_master.sh)" ] ; do
  sleep 1
done

echo "Telling sentinel to forget about the bootstrap replica..."
redis-cli -h $REDIS_SENTINEL_IP -p $REDIS_SENTINEL_PORT sentinel reset ${REDIS_MASTER_NAME}

echo "Redis init done, stopping bootstrap container."
