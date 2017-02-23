let bitcoin = require('bitcoinjs-lib')
let ldb = require('./ldb')
let parallel = require('run-parallel')
let rpc = require('./rpc')
let types = require('./types')
let { EventEmitter } = require('events')

let emitter = new EventEmitter()
emitter.setMaxListeners(Infinity)

let NOTHING = Buffer.alloc(0)

function connect (blockId, callback) {
  parallel({
    blockHeader: (f) => rpc('getblockheader', [blockId], f),
    blockHex: (f) => rpc('getblock', [blockId, false], f)
  }, (err, result) => {
    if (err) return callback(err)

    let { height, nextblockhash } = result.blockHeader
    let block = bitcoin.Block.fromHex(result.blockHex)
    let { transactions } = block

    let atomic = ldb.atomic()

    transactions.forEach((tx) => {
      let txId = tx.getId()

      tx.ins.forEach(({ hash, index: vout }, vin) => {
        let prevTxId = hash.reverse().toString('hex')

        atomic.put(types.txInIndex, { txId: prevTxId, vout }, { txId, vin })
      })

      tx.outs.forEach(({ script, value }, vout) => {
        let scId = bitcoin.crypto.sha256(script).toString('hex')

        atomic.put(types.scIndex, { scId, height, txId, vout }, NOTHING)
        atomic.put(types.txOutIndex, { txId, vout }, { value })
      })

      atomic.put(types.txIndex, txId, { height })
    })

    atomic.put(types.tip, NOTHING, blockId)
      .write((err) => callback(err, nextblockhash))
  })
}

function disconnect (blockId, callback) {
  parallel({
    blockHeader: (f) => rpc('getblockheader', [blockId], f),
    blockHex: (f) => rpc('getblock', [blockId, false], f)
  }, (err, result) => {
    if (err) return callback(err)

    let { height, previousblockhash } = result.blockHeader
    let block = bitcoin.Block.fromHex(result.blockHex)
    let { transactions } = block

    let atomic = ldb.atomic()

    transactions.forEach((tx) => {
      let txId = tx.getId()

      tx.ins.forEach(({ hash, index: vout }) => {
        let prevTxId = hash.reverse().toString('hex')

        atomic.del(types.txInIndex, { txId: prevTxId, vout })
      })

      tx.outs.forEach(({ script }, vout) => {
        let scId = bitcoin.crypto.sha256(script).toString('hex')

        atomic.del(types.scIndex, { scId, height, txId, vout })
        atomic.del(types.txOutIndex, { txId, vout })
      })

      atomic.put(types.txIndex, txId, { height })
    })

    atomic.put(types.tip, NOTHING, previousblockhash)
      .write(callback)
  })
}

function see (_, callback) {
  callback()
}

function tip (callback) {
  ldb.get(types.tip, NOTHING, callback)
}

module.exports = {
  connect,
  disconnect,
  see,
  tip
}
