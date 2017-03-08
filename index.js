require('dotenv').load()

let debug = require('debug')('index')
let leveldown = require('leveldown')
let localIndex = require('./local')
let qup = require('qup')
let resync = require('./resync')
let rpc = require('yajrpc/qup')({
  url: process.env.RPC,
  user: process.env.RPCUSER,
  pass: process.env.RPCPASSWORD,
  batch: process.env.RPCBATCHSIZE,
  concurrent: process.env.RPCCONCURRENT
})
let zmq = require('zmq')

function debugIfErr (err) {
  if (err) debug(err)
}

let db = leveldown(process.env.LEVELDB)
db.open({
  writeBufferSize: 1 * 1024 * 1024 * 1024
}, (err) => {
  if (err) return debugIfErr(err)
  debug('Opened database')

  let local = localIndex(rpc, db)
  let localSyncQueue = qup((_, next) => resync(rpc, local, next), 1)

  function localSyncAndReset (callback) {
    // maximum 2 waiting
    if (localSyncQueue.running > 1) return callback()

    localSyncQueue.push(null, (err) => {
      if (err) return callback(err)

      local.reset(callback)
    })
  }

  let zmqSock = zmq.socket('sub')
  zmqSock.connect(process.env.ZMQ)
  zmqSock.subscribe('hashblock')
  zmqSock.subscribe('hashtx')
  zmqSock.on('message', (topic, message) => {
    topic = topic.toString('utf8')
    debug(`zmq ${topic}`)

    if (topic === 'hashblock') return localSyncAndReset(debugIfErr)
    if (topic !== 'hashtx') return

    let txId = message.toString('hex')
    local.see(txId, debugIfErr)
  })

  localSyncAndReset(debugIfErr)
})
