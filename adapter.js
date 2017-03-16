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

    this.emitter.emit('transaction', txId, txBuffer)
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

Adapter.prototype.connect = function (blockId, height, callback) {
  this.rpc('getblock', [blockId, false], (err, blockHex) => {
    if (err) return callback(err)

    let blockBuffer = Buffer.from(blockHex, 'hex')
    let block = bitcoin.Block.fromBuffer(blockBuffer)
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

      let txBuffer = tx.toBuffer() // TODO: maybe we can slice this in fromBuffer
      this.emitter.emit('transaction', txId, txBuffer)
      atomic.put(types.txIndex, { txId }, { height })
    })

    this.emitter.emit('block', blockId, blockBuffer)
    debug(`Putting ${blockId} @ ${height} - ${block.transactions.length} transactions`)
    atomic.put(types.tip, {}, blockId).write(callback)
  })
}

Adapter.prototype.disconnect = function (blockId, callback) {
  parallel({
    blockHeader: (f) => this.rpc('getblockheader', [blockId], f),
    blockHex: (f) => this.rpc('getblock', [blockId, false], f)
  }, (err, result) => {
    if (err) return callback(err)

    let { height } = result.blockHeader
    let blockBuffer = Buffer.from(result.blockHex, 'hex')
    let block = bitcoin.Block.fromBuffer(blockBuffer)
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
    debug(`Deleting ${blockId} @ ${height} - ${block.transactions.length} transactions`)
    atomic.put(types.tip, {}, previousBlockId).write(callback)
  })
}

// queries
Adapter.prototype.blockByTransaction = function (txId, callback) {
  this.db.get(types.txIndex, txId, (err, height) => {
    if (err && err.notFound) return callback()
    if (err) return callback(err)

    this.rpc('getblockhash', [height], callback)
  })
}

Adapter.prototype.knownScript = function (scId, callback) {
  let result = false

  this.db.iterator(types.scIndex, {
    gte: { scId, height: 0, txId: ZERO64, vout: 0 },
    limit: 1
  }, () => {
    result = true
  }, (err) => {
    if (err) return callback(err)
    if (result) return callback(null, result)

    // maybe the mempool?
    let txos = this.mempool.scripts[scId]
    callback(null, Boolean(txos))
  })
}

Adapter.prototype.tip = function (callback) {
  this.db.get(types.tip, {}, (err, blockId) => {
    if (err && err.notFound) return callback()
    callback(err, blockId)
  })
}

let ZERO64 = '0000000000000000000000000000000000000000000000000000000000000000'
Adapter.prototype.txosByScript = function (scId, height, callback) {
  let resultMap = {}

  this.db.iterator(types.scIndex, {
    gte: { scId, height, txId: ZERO64, vout: 0 }
  }, ({ txId, vout, height }) => {
    resultMap[`${txId}:${vout}`] = { txId, vout, scId, height }
  }, (err) => {
    if (err) return callback(err)

    // merge with mempool
    let txos = this.mempool.scripts[scId]
    if (!txos) return

    txos.forEach(({ txId, vout }) => {
      resultMap[`${txId}:${vout}`] = { txId, vout, scId }
    })

    callback(null, resultMap)
  })
}

Adapter.prototype.spentFromTxo = function (txo, callback) {
  this.db.get(types.spentIndex, txo, (err, spent) => {
    if (err && err.notFound) return callback()
    if (err) return callback(err)

    callback(null, spent)
  })
}

Adapter.prototype.transactionsByScript = function (scId, height, callback) {
  this.txosByScript(scId, height, (err, txosMap) => {
    if (err) return callback(err)

    let taskMap = {}
    for (let txoKey in txosMap) {
      let txo = txosMap[txoKey]

      taskMap[txoKey] = (next) => {
        this.spentFromTxo(txo, (err, spent) => {
          if (err) return next(err)

          next(null, spent)
        })
      }
    }

    parallel(taskMap, (err, spentMap) => {
      if (err) return callback(err)

      let txIds = {}

      for (let x in spentMap) {
        let spent = spentMap[x]
        if (!spent) continue

        txIds[spent.txId] = true
      }

      for (let x in txosMap) {
        let { txId } = txosMap[x]
        txIds[txId] = true
      }

      callback(null, txIds)
    })
  })
}

module.exports = function makeAdapter (db, rpc) {
  return new Adapter(db, rpc)
}
