let bitcoin = require('bitcoinjs-lib')
let debug = require('debug')('local')
let ldb = require('./ldb')
let parallel = require('run-parallel')
let rpc = require('./rpc')
let types = require('./types')

function connectRaw (id, height, hex, callback) {
  let block = bitcoin.Block.fromHex(hex)
  let { transactions } = block

  let atomic = ldb.atomic()

  transactions.forEach((tx) => {
    let txId = tx.getId()

    tx.ins.forEach(({ hash, index: vout }, vin) => {
      if (bitcoin.Transaction.isCoinbaseHash(hash)) return

      let prevTxId = hash.reverse().toString('hex')

      atomic.put(types.spentIndex, { txId: prevTxId, vout }, { txId, vin })
    })

    tx.outs.forEach(({ script, value }, vout) => {
      let scId = bitcoin.crypto.sha256(script).toString('hex')

      atomic.put(types.scIndex, { scId, height, txId, vout }, null)
      atomic.put(types.txOutIndex, { txId, vout }, { value })
    })

    atomic.put(types.txIndex, { txId }, { height })
  })

  debug(`Putting ${id} @ ${height} - ${atomic.ops()} leveldb ops`)
  atomic.put(types.tip, {}, id).write(callback)
}

function connect (id, height, callback) {
  rpc('getblock', [id, false], (err, hex) => {
    if (err) return callback(err)

    connectRaw(id, height, hex, callback)
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
        if (bitcoin.Transaction.isCoinbaseHash(hash)) return

        let prevTxId = hash.reverse().toString('hex')

        atomic.del(types.spentIndex, { txId: prevTxId, vout })
      })

      tx.outs.forEach(({ script }, vout) => {
        let scId = bitcoin.crypto.sha256(script).toString('hex')

        atomic.del(types.scIndex, { scId, height, txId, vout })
        atomic.del(types.txOutIndex, { txId, vout })
      })

      atomic.put(types.txIndex, { txId }, { height })
    })

    debug(`Deleting ${blockId} - ${atomic.ops()} leveldb ops`)
    atomic.put(types.tip, {}, previousblockhash)
      .write(callback)
  })
}

// TODO
function see () {}

function tip (callback) {
  ldb.get(types.tip, {}, (err, blockId) => {
    if (err && err.notFound) return callback()
    callback(err, blockId)
  })
}

module.exports = {
  connect,
  disconnect,
  see,
  tip
}
