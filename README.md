# Redis Cluster Cache for Docker Swarm

Quick and dirty Redis cluster taking advantage of Redis Sentinel for automatic failover. Persistence is turned off by default.

## Usage

0. Setup docker swarm

1. Modify scripts/docker-compose.yml to how you want to deploy the stack.

2. deploy the stack with
```bash
docker stack deploy -c scripts/docker-compose.yml <stack name>
```

3. Connect to with redis-cli

```bash
docker exec -it $(docker ps --filter name=redis-sentinel -q) redis-cli
```

### Scaling

From now on just scale `redis` to expand the number of slaves or scale `redis-sentinel` to increase the number of sentinels.
