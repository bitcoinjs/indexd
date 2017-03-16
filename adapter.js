let bitcoin = require('bitcoinjs-lib')
let dbwrapper = require('./dbwrapper')
let debug = require('debug')('local')
let debugMempool = require('debug')('mempool')
let parallel = require('run-parallel')
let types = require('./types')
let { EventEmitter } = require('events')

function Mempool (emitter, rpc) {
  this.emitter = emitter
  this.rpc = rpc
  this.scripts = {}
  this.spents = {}
  this.txos = {}
}

Mempool.prototype.reset = function (callback) {
  this.scripts = {}
  this.spents = {}
  this.txos = {}
  this.statistics = {
    transactions: 0,
    inputs: 0,
    outputs: 0
  }

  debugMempool(`Cleared`)
  this.rpc('getrawmempool', [false], (err, actualTxIds) => {
    if (err) return callback(err)

    debugMempool(`Downloading ${actualTxIds.length} transactions`)
    let tasks = actualTxIds.map(txId => next => this.add(txId, next))

    parallel(tasks, (err) => {
      if (err) return callback(err)

      debugMempool(`Downloaded ${actualTxIds.length} transactions`)
      callback()
    })
  })
}

function getOrSetDefault (object, key, defaultValue) {
  let existing = object[key]
  if (existing !== undefined) return existing
  object[key] = defaultValue
  return defaultValue
}

let waiting
Mempool.prototype.add = function (txId, callback) {
  this.rpc('getrawtransaction', [txId, 0], (err, txHex) => {
    if (err && err.message.match(/^Error: No such mempool or blockchain transaction/)) {
      debugMempool(new Error(`${txId} unknown`))
      return callback()
    }
    if (err) return callback(err)

    let txBuffer = Buffer.from(txHex, 'hex')
    let tx = bitcoin.Transaction.fromBuffer(txBuffer)

    this.statistics.transactions++
    tx.ins.forEach(({ hash, index: vout }, vin) => {
      if (bitcoin.Transaction.isCoinbaseHash(hash)) return

      let prevTxId = hash.reverse().toString('hex')
      getOrSetDefault(this.spents, `${prevTxId}:${vout}`, []).push({ txId, vin })
      this.statistics.inputs++

      this.emitter.emit('spent', `${prevTxId}:${vout}`, txId, txBuffer)
    })

    tx.outs.forEach(({ script, value }, vout) => {
      let scId = bitcoin.crypto.sha256(script).toString('hex')

      getOrSetDefault(this.scripts, scId, []).push({ txId, vout })
      this.txos[`${txId}:${vout}`] = { value }
      this.statistics.outputs++

      this.emitter.emit('script', scId, txId, txBuffer)
    })

    if (!waiting) {
      waiting = true

      debugMempool(this.statistics)
      setTimeout(() => {
        waiting = false
      }, 30000)
    }

    callback()
  })
}

function Adapter (db, rpc) {
  this.db = dbwrapper(db)
  this.emitter = new EventEmitter()
  this.emitter.setMaxListeners(Infinity)
  this.mempool = new Mempool(this.emitter, rpc)
  this.rpc = rpc
  this.statistics = {
    transactions: 0,
    inputs: 0,
    outputs: 0
  }
}

Adapter.prototype.connectBlock = function (id, height, block, callback) {
  let atomic = this.db.atomic()

  block.transactions.forEach((tx) => {
    let txId = tx.getId()

    tx.ins.forEach(({ hash, index: vout }, vin) => {
      if (bitcoin.Transaction.isCoinbaseHash(hash)) return

      let prevTxId = hash.reverse().toString('hex')

      atomic.put(types.spentIndex, { txId: prevTxId, vout }, { txId, vin })

      this.emitter.emit('spent', `${prevTxId}:${vout}`, txId)
    })

    tx.outs.forEach(({ script, value }, vout) => {
      let scId = bitcoin.crypto.sha256(script).toString('hex')

      atomic.put(types.scIndex, { scId, height, txId, vout }, null)
      atomic.put(types.txoIndex, { txId, vout }, { value })

      this.emitter.emit('script', scId, txId)
    })

    atomic.put(types.txIndex, { txId }, { height })
  })

  debug(`Putting ${id} @ ${height} - ${block.transactions.length} transactions`)
  atomic.put(types.tip, {}, id).write(callback)
}

Adapter.prototype.connect = function (blockId, height, callback) {
  this.rpc('getblock', [blockId, false], (err, hex) => {
    if (err) return callback(err)

    let block = bitcoin.Block.fromHex(hex)
    this.connectBlock(blockId, height, block, callback)
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

    this.disconnectBlock(blockId, height, block, callback)
  })
}

Adapter.prototype.disconnectBlock = function (id, height, block, callback) {
  let atomic = this.db.atomic()

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

Adapter.prototype.tip = function (callback) {
  this.db.get(types.tip, {}, (err, blockId) => {
    if (err && err.notFound) return callback()
    callback(err, blockId)
  })
}

let ZERO64 = '0000000000000000000000000000000000000000000000000000000000000000'
Adapter.prototype.txosByScript = function (scIds, height, callback) {
  let resultMap = {}
  let tasks = scIds.map((scId) => {
    return (next) => {
      this.db.iterator(types.scIndex, {
        gte: { scId, height, txId: ZERO64, vout: 0 }
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

Adapter.prototype.exposureByScript = function (scIds, callback) {
  let resultMap = {}
  let tasks = scIds.map((scId) => {
    return (next) => {
      this.db.iterator(types.scIndex, {
        gte: { scId, height: 0, txId: ZERO64, vout: 0 },
        limit: 1
      }, () => {
        resultMap[scId] = true
      }, next)
    }
  })

  parallel(tasks, (err) => {
    if (err) return callback(err)

    // merge with mempool
    scIds.forEach((scId) => {
      let txos = this.mempool.scripts[scId]
      if (!txos) return
      resultMap[scId] = true
    })

    callback(null, resultMap)
  })
}

module.exports = function makeAdapter (db, rpc) {
  return new Adapter(db, rpc)
}
