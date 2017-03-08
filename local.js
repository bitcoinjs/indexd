let bitcoin = require('bitcoinjs-lib')
let dbwrapper = require('./dbwrapper')
let debug = require('debug')('local')
let debugMempool = require('debug')('mempool')
let parallel = require('run-parallel')
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

function disconnectBlock (db, id, height, block, callback) {
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

    atomic.del(types.txIndex, { txId }, { height })
  })

  // TODO: add helper to bitcoinjs-lib?
  let previousBlockId = Buffer.from(block.prevHash).reverse().toString('hex')
  debug(`Deleting ${id} @ ${height} - ${block.transactions.length} transactions`)
  atomic.put(types.tip, {}, previousBlockId).write(callback)
}

function LocalIndex (db, rpc) {
  this.db = dbwrapper(db)
  this.mempool = {
    scripts: {},
    spents: {},
    txouts: {}
  }
  this.rpc = rpc
}

LocalIndex.prototype.connect = function (blockId, height, callback) {
  this.rpc('getblock', [blockId, false], (err, hex) => {
    if (err) return callback(err)

    let block = bitcoin.Block.fromHex(hex)
    connectBlock(this.db, blockId, height, block, callback)
  })
}

LocalIndex.prototype.disconnect = function (blockId, callback) {
  parallel({
    header: (f) => this.rpc('getblockheader', [blockId], f),
    hex: (f) => this.rpc('getblock', [blockId, false], f)
  }, (err, result) => {
    if (err) return callback(err)

    let { height } = result.header
    let block = bitcoin.Block.fromHex(result.hex)

    disconnectBlock(this.db, blockId, height, block, callback)
  })
}

function getOrSetDefault (object, key, defaultValue) {
  let existing = object[key]
  if (existing !== undefined) return existing
  object[key] = defaultValue
  return defaultValue
}

let waiting
LocalIndex.prototype.see = function (txId, callback) {
  this.rpc('getrawtransaction', [txId, 0], (err, txHex) => {
    if (err) return callback(err)

    let tx = bitcoin.Transaction.fromHex(txHex)

    tx.ins.forEach(({ hash, index: vout }, vin) => {
      if (bitcoin.Transaction.isCoinbaseHash(hash)) return

      let prevTxId = hash.reverse().toString('hex')
      getOrSetDefault(this.mempool.spents, `${prevTxId}:${vout}`, []).push({ txId, vin })
    })

    tx.outs.forEach(({ script, value }, vout) => {
      let scId = bitcoin.crypto.sha256(script).toString('hex')

      getOrSetDefault(this.mempool.scripts, scId, []).push({ txId, vout })
      this.mempool.txouts[`${txId}:${vout}`] = { value }
    })

    if (!waiting) {
      waiting = true

      setTimeout(() => {
        waiting = false
        debugMempool(`txouts: ${Object.keys(this.mempool.txouts).length}`)
      }, 1000)
    }

    callback()
  })
}

LocalIndex.prototype.tip = function (callback) {
  this.db.get(types.tip, {}, (err, blockId) => {
    if (err && err.notFound) return callback()
    callback(err, blockId)
  })
}

let BLANK_TXID = '0000000000000000000000000000000000000000000000000000000000000000'
LocalIndex.prototype.txoutsByScript = function (scIds, height, callback) {
  let resultMap = {}
  let tasks = scIds.map((scId) => {
    return (next) => {
      this.db.iterator(types.scIndex, {
        gte: { scId, height, txId: BLANK_TXID, vout: 0 }
      }, ({ txId, vout }) => {
        resultMap[`${txId}:${vout}`] = true
      }, next)
    }
  })

  parallel(tasks, (err) => {
    if (err) return callback(err)

    // merge with mempool
    scIds.forEach((scId) => {
      let txOuts = this.mempool.scripts[scId]
      if (!txOuts) return

      txOuts.forEach(({ txId, vout }) => {
        resultMap[`${txId}:${vout}`] = true
      })
    })

    callback(null, resultMap)
  })
}

LocalIndex.prototype.reset = function (callback) {
  this.mempool = {
    scripts: {},
    spents: {},
    txouts: {}
  }

  debugMempool(`Cleared`)
  this.rpc('getrawmempool', [false], (err, actualTxIds) => {
    if (err) return callback(err)

    debugMempool(`Downloading ${actualTxIds.length} transactions`)
    let tasks = actualTxIds.map(txId => next => this.see(txId, next))

    parallel(tasks, (err) => {
      if (err) return callback(err)

      debugMempool(`Downloaded ${actualTxIds.length} transactions`)
      callback()
    })
  })
}

module.exports = function create (rpc, db) {
  return new LocalIndex(rpc, db)
}
