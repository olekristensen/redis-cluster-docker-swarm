FROM redis:5.0.7-alpine

LABEL version="1.0.4"

RUN apk add nodejs npm

RUN mkdir -p /redis/find_master

WORKDIR /redis/find_master
COPY find_master/package* ./
RUN npm install
COPY find_master/* ./

WORKDIR /redis

ENV QUORUM 2
ENV REDIS_SERVICE_NAME redis

COPY redis.conf *.sh ./
RUN chmod +x *.sh

EXPOSE 6379

CMD node /redis/find_master/index.js && redis-server /redis/redis.conf
