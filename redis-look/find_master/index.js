const metaRedisPort = 2473;
const path = '/data/appendonly.aof';
const template_path = '/redis/redis.conf';
const redis_conf_path = '/redis/redis-actual.conf';

/*
 * Algorithm:
 *
 * 1. Set status[self] = data timestamp or 'no data'
 * 2. Expose status on network
 * 3. for all siblings hosts:
 *     3.1 if host is master, end.
 *     3.2 fetch status from host
 *     3.2.1 on reply:
	   - host_info[host] = status[host]; host_status[host] = status;
	   - check convergene
 *     3.2.2 on timeout/error:
 *         - host_info[host] = 'dead'
 *     3.3 sleep short time
 *     3.4 loop to 3
 * 
 * check convergence:
 *   count = 0
 *   for hs in host_status:
 *     if hs == host_info:
 *       count += 1
 *   if count >= quorum:
 *     choose master based on status
 *
 * 
 * choose master based on status:
 *   find 1st element of host_info, with sorting criteria:
 *     ip address < data timestamp, most recent first < 'no data' < 'dead'
 *
 */

const Redis = require("ioredis");
const getIp = require("./ip");
const fs = require('fs');
const util = require('util');
const dns = require('dns');
const child_process = require('child_process');

const async_stat = util.promisify(fs.stat.bind(fs));
const async_lookup = util.promisify(dns.lookup.bind(dns));
const asyncAppendFile = util.promisify(fs.appendFile.bind(fs));
const asyncReadFile = util.promisify(fs.readFile.bind(fs));
const asyncWriteFile = util.promisify(fs.writeFile.bind(fs));

const searchRedisMaster = require('./search_redis_master').searchRedisMaster;

const local_redis = new Redis({
  port: metaRedisPort,
  host: 'localhost'
});

const remote_meta_redis = {};

let my_ip;
const host_info = {};
let update_timeout;

function disconnect_all() {
  for (let r in [local_redis, ...remote_meta_redis]) {
    r.disconnect();
  }
}

async function update_host_info() {
  if (update_timeout) {
    clearTimeout(update_timeout);
    update_timeout = undefined;
  }
  
  console.log('Status is now:', host_info);
  try {
    const result = await local_redis.set('status', JSON.stringify(host_info));
    if (result != 'OK') {
      throw('Local redis said: ' + result);
    }
  } catch (err) {
    console.warn('Can\'t update status to local redis, retrying in 3 sec:', err);
    setTimeout(update_host_info, 3000);
  }
}

async function set_local_info() {
  const ips = getIp();
  if (ips.length == 0) {
    console.warn('Can\'t figure out ip address');
    process.exit(1);
  }
  my_ip = ips[0];
  try {
    const s = await async_stat(path);
    host_info[my_ip] = s.mtime;
    console.warn('Last write to ' + path + ':', s.mtime);
  } catch(err) {
    console.warn('Failed to stat ' + path + ':', err);
    host_info[ips[0]] = 'no data';
  }
  update_host_info();
}

// Returns an array, for example:
// [ { address: '40.76.4.15', family: 4 },
//  { address: '40.112.72.205', family: 4 },
//  { address: '40.113.200.201', family: 4 },
//  { address: '104.215.148.63', family: 4 },
//  { address: '13.77.161.179', family: 4 } ]
function getAddresses(hostname) {
  return async_lookup(hostname, { all: true });
}

async function fetch_info(address) {
  if (!remote_meta_redis[address]) {
    remote_meta_redis[address] = new Redis({
        host: address,
        noDelay: true, 
        connectTimeout: 500,
        retryStrategy: () => false});
  }

  const reply = await remote_meta_redis[h.address].get('status');

  return JSON.parse(reply);
}

async function scan_all_hosts(hostname) {
  const hosts = getAddresses(hostname);
  if (hosts.length == 0) {
    throw("can't resolve " + hostname);
  }

  // Start all status queries
  const queries = Promise.allSettled(hosts.map(fetch_info));

  // Start and wait master search
  const redisMaster = await searchRedisMaster(hosts);

  if (redisMaster) {
    return { master: redisMaster };
  }
  const answers = await queries;
  const remote_status = {};
  for (let i = 0; i < answers.length; ++i) {
    const a = answers[i];
    const address = hosts[i].address;
    if (a.status == 'fulfilled') {
      host_info[address] = a.value[address];
      remote_status[address] = a.value;
    }
  }

  update_host_info();
  return { remote_status: remote_status };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms, 'timeout'));
}

function compare(a, b) {
  const keys = Object.keys({...a, ...b});
  for (let k of keys) {
    if (!(k in a) || !(k in b) || a[k] !== b[k]) {
      return false;
    }
  }
  return keys.length > 0;
}

function check_convergence(remote_status, quorum) {
  const num_agrees = 0;

  for (let addr in remote_status) {
    if (compare(remote_status[addr], host_info)) {
      num_agrees++;
    }
  }
  return num_agrees >= quorum;
}

async function determine_master(hostname, quorum) {
  set_local_info(hostname);
  let remote_status = {};

  while(!check_convergence(remote_status, quorum)) {
    try {
      const r = scan_all_hosts();

      if (r.master) {
        return r.master;
      }
      remote_status = r.remote_status;
    } catch(err) {
      console.warn('Scan all hosts failed with: ', err);
      console.warn('Retrying in 1 sec.');
      sleep(1000);
    }
  }

  disconnect_all();
  return select_master(remote_status);
}

async function start_redis(hostname, quorum) {
  const master = determine_master(hostname, quorum);
  const template = await asyncReadFile(template_path, 'utf8');

  if (master == my_ip) {
    console.log('Starting redis in master mode');
  } else {
    console.log('Starting redis as slave of ' + master);

    template += '\nslaveof ' + master +'\n';
  }

  await asyncWriteFile(redis_conf_path, template);

  const child = child_process.spawn('redis-server', [ redis_conf_path ], { detached: true });
  child.unref();
}

(async()=>{
  try {
    const metaredis = child_process.spawn('redis-server', [ '--port', metaRedisPort ]);
    metaredis.on('error', (err) => {
      console.error('Failed to start meta redis-server.');
    });

    await start_redis(process.env.REDIS_SERVICE_NAME,
                      parseInt(process.env.QUORUM || 2));

    metaredis.kill();
  } catch(err) {
    console.log('Failed to start redis: ', err);
    exit(1);
  }
})();

