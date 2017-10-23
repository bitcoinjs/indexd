let indexd = require('indexd')
let leveldown = require('leveldown')
let qup = require('qup')
let rpc = require('./rpc')
let zmq = require('zmq')

let db = leveldown(process.env.INDEXDB)
let adapter = indexd.makeAdapter(db, rpc)

module.exports = function initialize (callback) {
  function errorSink (err) {
    if (err) console.error(err)
  }

  console.log(`Opening leveldb @ ${process.env.INDEXDB}`)
  db.open({
    writeBufferSize: 1 * 1024 * 1024 * 1024
  }, (err) => {
    if (err) return callback(err)
    console.log(`Opened leveldb @ ${process.env.INDEXDB}`)

    let syncQueue = qup((_, next) => {
      indexd.resync(rpc, adapter, (err) => {
        if (err) return next(err)
        adapter.mempool.reset(next)
      })
    }, 1)

    let zmqSock = zmq.socket('sub')
    zmqSock.connect(process.env.ZMQ)
    zmqSock.subscribe('hashblock')
    zmqSock.subscribe('hashtx')

    let lastSequence
    zmqSock.on('message', (topic, message, sequence) => {
      topic = topic.toString('utf8')
      message = message.toString('hex')
      sequence = sequence.readUInt32LE()

      // if any ZMQ messages were lost,  assume a resync is required
      if (lastSequence !== undefined && (sequence !== (lastSequence + 1))) {
        console.log(`${sequence - lastSequence - 1} messages lost`)
        lastSequence = sequence
        return syncQueue.push(null, errorSink)
      }

      lastSequence = sequence
      if (topic === 'hashblock') {
        console.log(topic, message)
        return syncQueue.push(null, errorSink)
      }

      // don't add to the mempool until after a reset is complete
      if (syncQueue.running > 0) return
      if (topic !== 'hashtx') return
      console.logTx(topic, message)

      adapter.mempool.add(message, errorSink)
    })

    syncQueue.push(null, errorSink)
    callback()
  })
}
module.exports.adapter = adapter
