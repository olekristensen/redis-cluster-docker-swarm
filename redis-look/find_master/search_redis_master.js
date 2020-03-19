const Redis = require("ioredis");
const fs = require('fs');
const util = require('util');
const dns = require('dns');

const async_stat = util.promisify(fs.stat.bind(fs));
const async_lookup = util.promisify(dns.lookup.bind(dns));

function getAddresses(hostname) {
  return async_lookup(hostname, { all: true });
}


function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms, 'timeout'));
}

async function test(addr) {
  const redis = new Redis({ host: addr,
    noDelay: true, 
    connectTimeout: 500, retryStrategy: () => false});
  redis.on("error", () => {});

  try {
    const query = new Promise((resolve, reject) => {
    redis.sendCommand(
        new Redis.Command(
            'INFO',
            [], 
            'utf-8', 
            function(err,value) {
              if (err) { return reject(err); }

              const re = /.*role:([a-zA-Z0-9]+)/;
              const str = value.toString();
              const matches = str.match(re);
              if (matches) {
                resolve(matches[1]);
              } else {
                reject('Host: ' + addr + ' sent: ' + str);
              }
            }
        )
      );
    });
    if (await Promise.race([sleep(1000), query]) == 'timeout') {
      redis.disconnect();
      return 'bad';
    }
    const answer = await query;

    redis.disconnect();
    return answer;
  } catch (err) {
    redis.disconnect();
    //console.warn(err);
    return 'bad';
  }
}

module.exports.getAddresses = getAddresses;
module.exports.searchRedisMaster = async (addresses) => {
  try {
    const queries = addresses.map((entry) => { return {
      address: entry.address,
      status: test(entry.address)
    }; });

    for (let q of queries) {
      const reply = await q.status;
      if (reply == 'master') {
        return q.address;
      }
    }
    return undefined;
  } catch(err) {
    console.log(err);
    return undefined;
  }
};

