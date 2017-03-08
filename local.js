let bitcoin = require('bitcoinjs-lib')
let debug = require('debug')('local')
let leveldown = require('leveldown')
let parallel = require('run-parallel')
let tlevel = require('typed-leveldown')
let types = require('./types')

function connectBlock (db, id, height, block, callback) {
  let atomic = db.atomic()

  block.transactions.forEach((tx) => {
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

  debug(`Putting ${id} @ ${height} - ${block.transactions.length} transactions`)
  atomic.put(types.tip, {}, id).write(callback)
}

function disconnectBlock ({ db }, id, height, block, callback) {
  let atomic = db.atomic()

  block.transactions.forEach((tx) => {
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

  // TODO: add helper to bitcoinjs-lib?
  let previousBlockId = Buffer.from(block.prevHash).reverse().toString('hex')
  debug(`Deleting ${id} @ ${height} - ${block.transactions.length} transactions`)
  atomic.put(types.tip, {}, previousBlockId).write(callback)
}

function connect ({ db, rpc }, id, height, callback) {
  rpc('getblock', [id, false], (err, hex) => {
    if (err) return callback(err)

    let block = bitcoin.Block.fromHex(hex)
    connectBlock(db, id, height, block, callback)
  })
}

function disconnect ({ db, rpc }, id, callback) {
  parallel({
    header: (f) => rpc('getblockheader', [id], f),
    hex: (f) => rpc('getblock', [id, false], f)
  }, (err, result) => {
    if (err) return callback(err)

    let { height } = result.header
    let block = bitcoin.Block.fromHex(result.hex)

    disconnectBlock(db, id, height, block, callback)
  })
}

// TODO
function see () {}

function tip ({ db }, callback) {
  db.get(types.tip, {}, (err, blockId) => {
    if (err && err.notFound) return callback()
    callback(err, blockId)
  })
}

module.exports = function open (folderName, rpc, callback) {
  let db = leveldown(folderName)

  db.open({
    writeBufferSize: 1 * 1024 * 1024 * 1024
  }, (err) => {
    if (err) return callback(err)
    debug('Opened database')

    let context = {
      db: tlevel(db),
      rpc
    }

    callback(null, {
      connect: connect.bind(context),
      disconnect: disconnect.bind(context),
      see: see.bind(context),
      tip: tip.bind(context)
    })
  })
}
