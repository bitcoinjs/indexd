let bitcoin = require('bitcoinjs-lib')
let debug = require('debug')('local')
let leveldown = require('leveldown')
let parallel = require('run-parallel')
let rpc = require('./rpc')
let tlevel = require('typed-leveldown')
let types = require('./types')

function connectRaw (db, id, height, hex, callback) {
  let block = bitcoin.Block.fromHex(hex)
  let { transactions } = block

  let atomic = db.atomic()

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

  debug(`Putting ${id} @ ${height} - ${transactions.length} transactions`)
  atomic.put(types.tip, {}, id).write(callback)
}

function connect (db, id, height, callback) {
  rpc('getblock', [id, false], (err, hex) => {
    if (err) return callback(err)

    connectRaw(id, height, hex, callback)
  })
}

function disconnect (db, blockId, callback) {
  parallel({
    blockHeader: (f) => rpc('getblockheader', [blockId], f),
    blockHex: (f) => rpc('getblock', [blockId, false], f)
  }, (err, result) => {
    if (err) return callback(err)

    let { height, previousblockhash } = result.blockHeader
    let block = bitcoin.Block.fromHex(result.blockHex)
    let { transactions } = block

    let atomic = db.atomic()

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

    debug(`Deleting ${blockId} - ${transactions.length} transactions`)
    atomic.put(types.tip, {}, previousblockhash).write(callback)
  })
}

// TODO
function see () {}

function tip (db, callback) {
  db.get(types.tip, {}, (err, blockId) => {
    if (err && err.notFound) return callback()
    callback(err, blockId)
  })
}

module.exports = function open (folderName, callback) {
  let db = leveldown(folderName)

  db.open({
    writeBufferSize: 1 * 1024 * 1024 * 1024
  }, (err) => {
    if (err) return callback(err)
    debug('Opened database')

    let tdb = tlevel(db)

    callback(null, {
      connect: connect.bind(tdb),
      disconnect: disconnect.bind(tdb),
      see: see.bind(tdb),
      tip: tip.bind(tdb)
    })
  })
}
