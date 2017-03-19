let bitcoin = require('bitcoinjs-lib')
let debug = require('debug')('blockchain')
let parallel = require('run-parallel')
let types = require('./types')

function Blockchain (emitter, db, rpc) {
  this.emitter = emitter
  this.db = db
  this.rpc = rpc
}

Blockchain.prototype.connect = function (blockId, height, callback) {
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

    this.emitter.emit('block', blockId, blockBuffer, height)
    debug(`Putting ${blockId} @ ${height} - ${block.transactions.length} transactions`)
    atomic.put(types.tip, {}, blockId).write(callback)
  })
}

Blockchain.prototype.disconnect = function (blockId, callback) {
  parallel({
    blockHeader: (f) => this.rpc('getblockheader', [blockId, true], f),
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

// QUERIES
Blockchain.prototype.blockByTransaction = function (txId, callback) {
  this.db.get(types.txIndex, { txId }, (err, row) => {
    if (err && err.notFound) return callback()
    if (err) return callback(err)

    this.rpc('getblockhash', [row.height], callback)
  })
}

let ZERO64 = '0000000000000000000000000000000000000000000000000000000000000000'
Blockchain.prototype.knownScript = function (scId, callback) {
  let result = false

  this.db.iterator(types.scIndex, {
    gte: { scId, height: 0, txId: ZERO64, vout: 0 },
    lt: { scId, height: 0xffffffff, txId: ZERO64, vout: 0 },
    limit: 1
  }, () => {
    result = true
  }, (err) => callback(err, result))
}

Blockchain.prototype.tip = function (callback) {
  this.db.get(types.tip, {}, (err, blockId) => {
    if (err && err.notFound) return callback()
    callback(err, blockId)
  })
}

Blockchain.prototype.txosByScript = function (scId, height, callback) {
  let resultMap = {}

  this.db.iterator(types.scIndex, {
    gte: { scId, height, txId: ZERO64, vout: 0 },
    lt: { scId, height: 0xffffffff, txId: ZERO64, vout: 0 }
  }, ({ txId, vout, height }) => {
    resultMap[`${txId}:${vout}`] = { txId, vout, scId, height }
  }, (err) => callback(err, resultMap))
}

Blockchain.prototype.spentFromTxo = function (txo, callback) {
  this.db.get(types.spentIndex, txo, (err, result) => {
    if (err && err.notFound) return callback()
    if (err) return callback(err)

    callback(null, result)
  })
}

Blockchain.prototype.transactionsByScript = function (scId, height, callback) {
  this.txosByScript(scId, height, (err, txosMap) => {
    if (err) return callback(err)

    let taskMap = {}
    for (let txoKey in txosMap) {
      let txo = txosMap[txoKey]

      taskMap[txoKey] = (next) => this.spentFromTxo(txo, next)
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

module.exports = Blockchain
