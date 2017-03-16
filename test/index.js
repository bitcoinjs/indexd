require('dotenv').load()

let debug = require('debug')('index')
let debugZmq = require('debug')('zmq')
let debugZmqTx = require('debug')('zmq:tx')
let indexd = require('../')
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

debug(`Opening leveldb @ ${process.env.LEVELDB}`)
let db = leveldown(process.env.LEVELDB)
db.open({
  writeBufferSize: 1 * 1024 * 1024 * 1024
}, (err) => {
  if (err) return debugIfErr(err)
  debug(`Opened leveldb @ ${process.env.LEVELDB}`)

  let adapter = indexd.makeAdapter(db, rpc)
  let syncQueue = qup((_, next) => indexd.resync(rpc, adapter, next), 1)

  function syncAndReset (callback) {
    syncQueue.push(null, (err) => {
      if (err) return callback(err)

      adapter.mempool.reset(callback)
    })
  }

  let zmqSock = zmq.socket('sub')
  zmqSock.connect(process.env.ZMQ)
  zmqSock.subscribe('hashblock')
  zmqSock.subscribe('hashtx')

  let expected
  zmqSock.on('message', (topic, message, sequence) => {
    topic = topic.toString('utf8')
    message = message.toString('hex')
    sequence = sequence.readUInt32LE()
    if (expected === undefined) {
      expected = sequence
    } else if (expected + 1 !== sequence) {
      debugZmq(`${sequence - expected - 1} messages lost`)
    } else {
      expected = sequence
    }

    if (topic === 'hashblock') {
      debugZmq(topic, message)
      return syncAndReset(debugIfErr)
    }

    if (topic !== 'hashtx') return
    debugZmqTx(topic, message)

    adapter.mempool.add(message, debugIfErr)
  })

  syncAndReset(debugIfErr)
})
