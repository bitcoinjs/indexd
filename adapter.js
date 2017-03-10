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
      atomic.put(types.txoIndex, { txId, vout }, { value })
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
      atomic.del(types.txoIndex, { txId, vout })
    })

    atomic.del(types.txIndex, { txId }, { height })
  })

  // TODO: add helper to bitcoinjs-lib?
  let previousBlockId = Buffer.from(block.prevHash).reverse().toString('hex')
  debug(`Deleting ${id} @ ${height} - ${block.transactions.length} transactions`)
  atomic.put(types.tip, {}, previousBlockId).write(callback)
}

function Adapter (db, rpc) {
  this.db = dbwrapper(db)
  this.mempool = {
    scripts: {},
    spents: {},
    txos: {}
  }
  this.rpc = rpc
  this.statistics = {
    transactions: 0,
    inputs: 0,
    outputs: 0
  }
}

Adapter.prototype.connect = function (blockId, height, callback) {
  this.rpc('getblock', [blockId, false], (err, hex) => {
    if (err) return callback(err)

    let block = bitcoin.Block.fromHex(hex)
    connectBlock(this.db, blockId, height, block, callback)
  })
}

Adapter.prototype.disconnect = function (blockId, callback) {
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
Adapter.prototype.see = function (txId, callback) {
  this.rpc('getrawtransaction', [txId, 0], (err, txHex) => {
    if (err) return callback(err)

    let tx = bitcoin.Transaction.fromHex(txHex)

    this.statistics.transactions++
    tx.ins.forEach(({ hash, index: vout }, vin) => {
      if (bitcoin.Transaction.isCoinbaseHash(hash)) return

      let prevTxId = hash.reverse().toString('hex')
      getOrSetDefault(this.mempool.spents, `${prevTxId}:${vout}`, []).push({ txId, vin })
      this.statistics.inputs++
    })

    tx.outs.forEach(({ script, value }, vout) => {
      let scId = bitcoin.crypto.sha256(script).toString('hex')

      getOrSetDefault(this.mempool.scripts, scId, []).push({ txId, vout })
      this.mempool.txos[`${txId}:${vout}`] = { value }
      this.statistics.outputs++
    })

    if (!waiting) {
      waiting = true

      debugMempool(JSON.stringify(this.statistics))
      setTimeout(() => {
        waiting = false
      }, 30000)
    }

    callback()
  })
}

Adapter.prototype.tip = function (callback) {
  this.db.get(types.tip, {}, (err, blockId) => {
    if (err && err.notFound) return callback()
    callback(err, blockId)
  })
}

let BLANK_TXID = '0000000000000000000000000000000000000000000000000000000000000000'
Adapter.prototype.txosByScript = function (scIds, height, callback) {
  let resultMap = {}
  let tasks = scIds.map((scId) => {
    return (next) => {
      this.db.iterator(types.scIndex, {
        gte: { scId, height, txId: BLANK_TXID, vout: 0 }
      }, ({ txId, vout, height }) => {
        resultMap[`${txId}:${vout}`] = { txId, vout, scId, height }
      }, next)
    }
  })

  parallel(tasks, (err) => {
    if (err) return callback(err)

    // merge with mempool
    scIds.forEach((scId) => {
      let txos = this.mempool.scripts[scId]
      if (!txos) return

      txos.forEach(({ txId, vout }) => {
        resultMap[`${txId}:${vout}`] = { txId, vout, scId }
      })
    })

    callback(null, resultMap)
  })
}

Adapter.prototype.txisByTxos = function (txos, callback) {
  let tasks = []
  for (let x in txos) {
    let txo = txos[x]

    tasks.push((next) => this.db.get(types.spentIndex, txo, (err, txi) => {
      if (err && err.notFound) return callback()
      if (err) return callback(err)

      next(null, txi)
    }))
  }

  parallel(tasks, callback)
}

Adapter.prototype.transactionsByScript = function (scIds, height, callback) {
  this.txosByScript(scIds, height, (err, txosMap) => {
    if (err) return callback(err)

    this.txisByTxos(txosMap, (err, txisList) => {
      if (err) return callback(err)

      let txIds = {}

      for (let x in txosMap) {
        let { txId } = txosMap[x]
        txIds[txId] = true
      }
      txisList.forEach(({ txId }) => (txIds[txId] = true))

      callback(null, txIds)
    })
  })
}

Adapter.prototype.reset = function (callback) {
  this.mempool = {
    scripts: {},
    spents: {},
    txos: {}
  }
  this.statistics = {
    transactions: 0,
    inputs: 0,
    outputs: 0
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

module.exports = function makeAdapter (db, rpc) {
  return new Adapter(db, rpc)
}
