let dbwrapper = require('./dbwrapper')
let { EventEmitter } = require('events')

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

// queries
Adapter.prototype.blockByTransaction = function (txId, callback) {
  this.blockchain.blockByTransaction(txId, callback)
}

Adapter.prototype.knownScript = function (scId, callback) {
  this.blockchain.knownScript(scId, (err, result) => {
    if (err) return callback(err)
    callback(null, result || this.mempool.knownScript(scId))
  })
}

Adapter.prototype.tip = function (callback) {
  this.blockchain.tip(callback)
}

Adapter.prototype.txosByScript = function (scId, height, callback) {
  let resultMap = {}

  this.blockchain.txosByScript(scId, height, (err, txosMap) => {
    if (err) return callback(err)

    Object.assign(resultMap, this.mempool.txosByScript(scId))
    callback(null, resultMap)
  })
}

Adapter.prototype.txoByTxo = function (txId, vout, callback) {
  this.blockchain.txoByTxo(txId, vout, (err, txo) => {
    if (err) return callback(err)

    // if in blockchain, ignore the mempool
    if (txo) return callback(null, txo)

    // otherwise, could be multiple spents in the mempool
    callback(null, this.mempool.txoByTxo(txId, vout))
  })
}

Adapter.prototype.spentsFromTxo = function (txo, callback) {
  this.blockchain.spentFromTxo(txo, (err, spent) => {
    if (err) return callback(err)

    // if in blockchain, ignore the mempool
    if (spent) return callback(null, [spent])

    // otherwise, could be multiple spents in the mempool
    callback(null, this.mempool.spentsFromTxo(txo))
  })
}

Adapter.prototype.transactionsByScript = function (scId, height, callback) {
  this.blockchain.transactionsByScript(scId, height, (err, txIds) => {
    if (err) return callback(err)

    Object.assign(txIds, this.mempool.transactionsByScript(scId))
    callback(null, txIds)
  })
}

module.exports = function makeAdapter (db, rpc) {
  return new Adapter(db, rpc)
}
