#/bin/bash
docker stack deploy -c <(docker-compose -f ./redis.yml config) cache