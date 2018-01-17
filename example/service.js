let debug = require('debug')('example:service')
let debugZmq = require('debug')('service:zmq')
let debugZmqTx = require('debug')('service:zmq:tx')
// let indexd = require('indexd') // XXX: you should use npm published package typically
let indexd = require('../')
let leveldown = require('leveldown')
let rpc = require('./rpc')
let zmq = require('zmq')

let db = leveldown(process.env.INDEXDB)
let adapter = indexd.makeAdapter(db, rpc)

module.exports = function initialize (callback) {
  function errorSink (err) {
    if (err) debug(err)
  }

  let syncing = false
  function resync () {
    // already in progress?
    if (syncing) return
    syncing = true

    indexd.resync(rpc, adapter, (err) => {
      syncing = false
      errorSink(err)
      adapter.mempool.reset(errorSink)
    })
  }

  debug(`Opening leveldb @ ${process.env.INDEXDB}`)
  db.open({
    writeBufferSize: 1 * 1024 * 1024 * 1024 // 1 GiB
  }, (err) => {
    if (err) return callback(err)
    debug(`Opened leveldb @ ${process.env.INDEXDB}`)

    let zmqSock = zmq.socket('sub')
    zmqSock.connect(process.env.ZMQ)
    zmqSock.subscribe('hashblock')
    zmqSock.subscribe('hashtx')

    let lastSequence = 0
    zmqSock.on('message', (topic, message, sequence) => {
      topic = topic.toString('utf8')
      message = message.toString('hex')
      sequence = sequence.readUInt32LE()

      // were any ZMQ messages were lost?
      let expectedSequence = lastSequence + 1
      lastSequence = sequence
      if (sequence !== expectedSequence) {
        if (sequence < expectedSequence) debugZmq(`bitcoind may have restarted`)
        else debugZmq(`${sequence - expectedSequence} messages lost`)
        resync()
      }

      switch (topic) {
        case 'hashblock': {
          debugZmq(topic, message)
          return resync()
        }

        case 'hashtx': {
          debugZmqTx(topic, message)
          return adapter.mempool.add(message, errorSink)
        }
      }
    })

    setInterval(resync, 60000) // attempt every minute
    resync()

    callback()
  })
}
module.exports.adapter = adapter
