FROM redis:5.0.7-alpine

LABEL version="1.0.3"

ENV REDIS_SENTINEL_IP redis-sentinel
ENV REDIS_MASTER_NAME redismaster
ENV REDIS_SENTINEL_PORT 26379

RUN mkdir /redis
WORKDIR /redis

COPY redis.conf *.sh ./
RUN chmod +x *.sh

EXPOSE 26379

CMD ["/redis/start-slave.sh"]
