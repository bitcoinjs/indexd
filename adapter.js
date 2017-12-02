let dbwrapper = require('./dbwrapper')
let { EventEmitter } = require('events')
let parallel = require('run-parallel')

let Blockchain = require('./blockchain')
let Mempool = require('./mempool')

function Adapter (db, rpc) {
  this.db = dbwrapper(db)
  this.emitter = new EventEmitter()
  this.emitter.setMaxListeners(Infinity)

  this.blockchain = new Blockchain(this.emitter, this.db, rpc)
  this.mempool = new Mempool(this.emitter, rpc)
}

Adapter.prototype.connect = function (blockId, height, callback) {
  this.blockchain.connect(blockId, height, callback)
}

Adapter.prototype.disconnect = function (blockId, callback) {
  this.blockchain.disconnect(blockId, callback)
}

// QUERIES
Adapter.prototype.blockIdByTransactionId = function (txId, callback) {
  this.blockchain.blockIdByTransactionId(txId, callback)
}

Adapter.prototype.fees = function (n, callback) {
  this.blockchain.fees(n, callback)
}

// returns whether (true/false) the script id (SHA256(script)) has even been seen
Adapter.prototype.seenScriptId = function (scId, callback) {
  this.blockchain.seenScriptId(scId, (err, result) => {
    if (err) return callback(err)
    callback(null, result || this.mempool.seenScriptId(scId))
  })
}

// returns list of inputs that spends {txo}, array length is guaranteed to be 1 if confirmed [on the blockchain]
Adapter.prototype.spentsFromTxo = function (txo, callback) {
  this.blockchain.spentFromTxo(txo, (err, spent) => {
    if (err) return callback(err)

    // if in blockchain, ignore the mempool
    if (spent) return callback(null, [spent])

    // otherwise, could be multiple spents in the mempool
    callback(null, this.mempool.spentsFromTxo(txo))
  })
}

// returns blockchain chain tip id
Adapter.prototype.tip = function (callback) {
  this.blockchain.tip(callback)
}

// returns blockchain chain tip height
Adapter.prototype.tipHeight = function (callback) {
  this.blockchain.tipHeight(callback)
}

// returns set of transactions associated with script id (SHA256(script))
// minimum height can be provided if many transaction associations exist
Adapter.prototype.transactionIdsByScriptId = function (scId, height, callback, dbLimit) {
  this.blockchain.transactionIdsByScriptId(scId, height, (err, txIds, position) => {
    if (err) return callback(err)

    Object.assign(txIds, this.mempool.transactionIdsByScriptId(scId))
    callback(null, txIds, position)
  }, dbLimit)
}

Adapter.prototype.transactionIdListFromScriptId = function (scId, height, callback, dbLimit) {
  this.blockchain.transactionIdsByScriptId(scId, height, (err, txIdSet, position) => {
    if (err) return callback(err)

    let txIds = []
    for (let txId in txIdSet) txIds.push(txId)

    let txIdSet2 = this.mempool.transactionIdsByScriptId(scId)
    for (let txId in txIdSet2) {
      if (txIdSet[txId]) continue // prevent [impossible?] duplicates
      txIds.push(txId)
    }

    callback(null, txIds, position)
  }, dbLimit)
}

// returns a mapping of txos (`txid:vout`) for script id, mapping guarantees no duplicates
// the format `txid:vout`: { .., scId }, supports streamline merging with other queries
Adapter.prototype.txosByScriptId = function (scId, height, callback, dbLimit) {
  let resultMap = {}

  this.blockchain.txosByScriptId(scId, height, (err, txosMap) => {
    if (err) return callback(err)

    Object.assign(resultMap, txosMap, this.mempool.txosByScriptId(scId))
    callback(null, resultMap)
  }, dbLimit)
}

// returns a list of { txId, vout, scId, height }, height is undefined if from the mempool
// has a weak guarantee of no duplicates, enforced by mempool.clear in resync
Adapter.prototype.txosListByScriptId = function (scId, height, callback, dbLimit) {
  this.blockchain.__txosListByScriptId(scId, height, (err, txos) => {
    if (err) return callback(err)

    callback(null, txos.concat(this.mempool.__txosListByScriptId(scId)))
  }, dbLimit)
}

// returns extra txo information ({ txId, vout, value }) for the provided txo
// TODO: see #15
Adapter.prototype.txoByTxo = function (txId, vout, callback) {
  this.blockchain.txoByTxo(txId, vout, (err, txo) => {
    if (err) return callback(err)

    // if in blockchain, ignore the mempool
    if (txo) return callback(null, txo)

    callback(null, this.mempool.txoByTxo(txId, vout))
  })
}

// returns a list of unspent txos
Adapter.prototype.utxosByScriptId = function (scId, height, callback, limit) {
  this.txosByScriptId(scId, height, (err, txos) => {
    if (err) return callback(err)

    txos = Object.keys(txos).map(x => txos[x])
    let tasks = txos.map((txo) => {
      return (next) => this.spentsFromTxo(txo, (err, spents) => {
        if (err) return next(err)
        if (spents.length !== 0) return next()

        this.txoByTxo(txo.txId, txo.vout, (err, txoExtra) => {
          if (err) return next(err)

          next(null, Object.assign(txo, txoExtra))
        })
      })
    })

    parallel(tasks, (err, txos) => {
      if (err) return callback(err, txos)
      // filter empty txos
      callback(err, txos.filter(txo => txo !== undefined))
    })
  }, limit)
}

module.exports = function makeAdapter (db, rpc) {
  return new Adapter(db, rpc)
}
