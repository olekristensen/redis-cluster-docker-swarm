FROM redis:5.0.7-alpine

LABEL version="1.0.3"

ENV REDIS_SENTINEL_IP redis-sentinel
ENV REDIS_MASTER_NAME redismaster
ENV REDIS_SENTINEL_PORT 26379

COPY entrypoint.sh /usr/local/bin/

RUN chmod +x /usr/local/bin/entrypoint.sh

WORKDIR /redis
COPY redis.conf .

EXPOSE 26379

ENTRYPOINT ["entrypoint.sh"]
