const metaRedisPort = 2473;
const path = '/data/appendonly.aof';
const template_path = '/redis/redis.conf';
const redis_conf_path = '/redis/redis-actual.conf';
const quorum = parseInt(process.env.QUORUM);

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

const async_stat = util.promisify(fs.stat);
const async_lookup = util.promisify(dns.lookup.bind(dns));
const asyncAppendFile = util.promisify(fs.appendFile.bind(fs));
const asyncReadFile = util.promisify(fs.readFile.bind(fs));
const asyncWriteFile = util.promisify(fs.writeFile.bind(fs));

const searchRedisMaster = require('./search_redis_master').searchRedisMaster;

let local_redis;
const remote_meta_redis = {};

let my_ip;
let my_info;
const host_info = {};
let update_timeout;

function disconnect_all() {
  for (let r in remote_meta_redis) {
    remote_meta_redis[r].disconnect();
  }
  local_redis.disconnect();
}

function compareHosts(entry_a, entry_b) {
  const a = entry_a.value;
  const b = entry_b.value;

  if (a == b) {
    return entry_a.host < entry_b.host ? -1 : (entry_a.host == entry_b.host ? 0 : 1);
  }
  if (a == 'dead') return 1;
  if (b == 'dead') return -1;
  if (a == 'no data') return 1;
  if (b == 'no data') return -1;
  return new Date(a) < new Date(b) ? 1 : -1;
}

function select_master() {
  // host_info has enough support.
  const candidates = [];
  for (let h in host_info) {
    const value = host_info[h];
    if (h != 'master' && ((value == 'no data') || !isNaN(new Date(value).getTime()))) {
      candidates.push({host: h, value: value});
    }
  }
  if (candidates.length < quorum) {
    return undefined;
  }
  candidates.sort(compareHosts);
  console.log('Candidates, after sorting:', candidates);
  return candidates[0].host;
}

async function update_host_info() {
  if (update_timeout) {
    clearTimeout(update_timeout);
    update_timeout = undefined;
  }

  if(!local_redis) { 
    local_redis = new Redis({
      port: metaRedisPort,
      host: 'localhost',
      noDelay: true, 
      connectTimeout: 500,
      maxRetriesPerRequest: 0});
  }
  
  if (my_info) {
    host_info[my_ip] = my_info;
  }
  host_info['master'] = select_master();
  console.log(my_ip, ': status is now:', host_info);
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
  console.log('my ips: ', ips[0]);
  my_ip = ips[0];
  try {
    const s = await async_stat(path);
    my_info = s.mtime;
    console.warn('Last write to ' + path + ':', s.mtime);
  } catch(err) {
    console.warn('Failed to stat ' + path + ':');
    my_info = 'no data';
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
  try {
    if (!remote_meta_redis[address]) {
      const redis = remote_meta_redis[address] = new Redis({
	  host: address,
	  port: metaRedisPort,
	  noDelay: true, 
	  connectTimeout: 500,
	  maxRetriesPerRequest: 0,
	  retryStrategy: () => false});
      redis.on("error", () => {});
    }

    const reply = await remote_meta_redis[address].get('status');

    const data = JSON.parse(reply);

    for (let h in data) {
      const d = new Date(data[h]);
      if (!isNaN(d.getTime())) {
	data[h] = d;
      }
    }

    return data;
  } catch (err) {
    console.warm("When getting status of ", address, ": ", err);
    return 'dead';
  }
}

async function scan_all_hosts(hostname) {
  const hosts = await getAddresses(hostname);
  
  if (hosts.length == 0) {
    throw("can't resolve " + hostname);
  }

  // Start all status queries
  const queries = Promise.allSettled(
    hosts
      .map((a) => a.address)
      .filter((a) => a != my_ip)
      .map(fetch_info));

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
    if (a.status == 'fulfilled' && typeof(a.value) == 'object' && a.value != null) {
      console.log(address, 'new status:', a.value);
      host_info[address] = a.value[address];
      remote_status[address] = a.value;
    } else {
      console.log(address, 'is dead:', a.value);
      host_info[address] = 'dead';
    }
  }

  update_host_info();
  return { remote_status: remote_status };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms, 'timeout'));
}

function isDeadOrUndefined(a) {
  return a == undefined || a == 'dead';
}

function compare(a, b) {
  return a.master && a.master == b.master;
}

function check_convergence(remote_status, quorum) {
  if (!host_info.master) {
    return false;
  }
  let num_agrees = 0;
 
  // make sure we count our own vote.
  remote_status[my_ip] = host_info;

  for (let addr in remote_status) {
    if (compare(remote_status[addr], host_info)) {
      num_agrees++;
    }
  }
  console.log(my_ip, ': Quorum support:', num_agrees, '/', quorum, 'for master:', host_info.master);
  return num_agrees >= quorum && my_ip == host_info.master;
}


async function determine_master(hostname, quorum) {
  await set_local_info(hostname);
  let remote_status = {};

  while(!check_convergence(remote_status, quorum)) {
    try {
      const r = await scan_all_hosts(hostname);

      if (r.master) {
        return r.master;
      }
      remote_status = r.remote_status;
    } catch(err) {
      console.warn('Scan all hosts failed with: ', err);
      console.warn('Retrying in 1 sec.');
    }
    await sleep(1000);
  }

  disconnect_all();
  return host_info.master;
}

async function start_redis(hostname, quorum) {
  const master = await determine_master(hostname, quorum);
  let template = await asyncReadFile(template_path, 'utf8');

  if (master == my_ip) {
    console.log(my_ip, ' configuring redis in master mode');
  } else {
    console.log(my_ip, ' configuring redis as slave of ' + master);

    template += '\nreplicaof ' + master + ' 6379\n';
  }

  await asyncWriteFile(redis_conf_path, template);

  //const child = child_process.spawn('redis-server', [ redis_conf_path ], { detached: true });
  //child.unref();
}

(async()=>{
  try {
    const metaredis = child_process.spawn('redis-server', [ '--port', metaRedisPort ],
      { stdio: 'inherit' });
    metaredis.on('error', (err) => {
      console.error('Failed to start meta redis-server.');
      process.exit(2);
    });

    await start_redis(process.env.REDIS_SERVICE_NAME,
                      parseInt(process.env.QUORUM || 2));

    metaredis.kill();
    process.exit(0);
  } catch(err) {
    console.log('Failed to start redis: ', err);
    process.exit(1);
  }
})();

