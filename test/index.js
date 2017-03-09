require('dotenv').load()

let debug = require('debug')('index')
let debugZmq = require('debug')('zmq')
let indexd = require('indexd')
let leveldown = require('leveldown')
let qup = require('qup')
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
  debug(`Opened leveldb @ ${process.env.LEVELDB}`)

  let adapter = indexd.makeAdapter(db, rpc)
  let syncQueue = qup((_, next) => indexd.resync(rpc, adapter, next), 1)

  function syncAndReset (callback) {
    // maximum 2 waiting
    if (syncQueue.running > 1) return callback()

    syncQueue.push(null, (err) => {
      if (err) return callback(err)

      adapter.reset(callback)
    })
  }

  let zmqSock = zmq.socket('sub')
  zmqSock.connect(process.env.ZMQ)
  zmqSock.subscribe('hashblock')
  zmqSock.subscribe('hashtx')
  zmqSock.on('message', (topic, message) => {
    topic = topic.toString('utf8')
    debugZmq(topic)

    if (topic === 'hashblock') return syncAndReset(debugIfErr)
    if (topic !== 'hashtx') return

    let txId = message.toString('hex')
    adapter.see(txId, debugIfErr)
  })

  syncAndReset(debugIfErr)
})
