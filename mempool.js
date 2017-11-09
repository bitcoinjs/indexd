let debug = require('./debug')('indexd:mempool')
let parallel = require('run-parallel')
let rpcUtil = require('./rpc')

function Mempool (emitter, rpc) {
  this.emitter = emitter
  this.rpc = rpc
  this.scripts = {}
  this.spents = {}
  this.txos = {}

  this.statistics = {
    transactions: 0,
    inputs: 0,
    outputs: 0
  }
}

function getOrSetDefault (object, key, defaultValue) {
  let existing = object[key]
  if (existing !== undefined) return existing
  object[key] = defaultValue
  return defaultValue
}

let waiting
Mempool.prototype.add = function (txId, callback) {
  rpcUtil.transaction(this.rpc, txId, (err, tx) => {
    if (err) return callback(err)
    if (!tx) {
      debug(`${txId} dropped`)
      return callback()
    }

    let { txBuffer, ins, outs } = tx

    this.statistics.transactions++
    ins.forEach((input, vin) => {
      if (input.coinbase) return
      let { prevTxId, vout } = input

      getOrSetDefault(this.spents, `${prevTxId}:${vout}`, []).push({ txId, vin })
      this.statistics.inputs++

      setTimeout(() => this.emitter.emit('spent', `${prevTxId}:${vout}`, txId, txBuffer))
    })

    outs.forEach(({ scId, value }, vout) => {
      getOrSetDefault(this.scripts, scId, []).push({ txId, vout })
      this.txos[`${txId}:${vout}`] = { value }
      this.statistics.outputs++

      setTimeout(() => this.emitter.emit('script', scId, txId, txBuffer))
    })

    if (!waiting) {
      waiting = true

      debug(this.statistics)
      setTimeout(() => {
        waiting = false
      }, 30000)
    }

    setTimeout(() => this.emitter.emit('transaction', txId, txBuffer))
    callback()
  }, true)
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

  debug(`Cleared`)
  rpcUtil.mempool(this.rpc, (err, actualTxIds) => {
    if (err) return callback(err)

    debug(`Downloading ${actualTxIds.length} transactions`)
    let tasks = actualTxIds.map(txId => next => this.add(txId, next))

    parallel(tasks, (err) => {
      if (err) return callback(err)

      debug(`Downloaded ${actualTxIds.length} transactions`)
      callback()
    })
  })
}

// QUERIES
Mempool.prototype.seenScriptId = function (scId) {
  return Boolean(this.scripts[scId])
}

Mempool.prototype.spentsFromTxo = function ({ txId, vout }) {
  return this.spents[`${txId}:${vout}`] || []
}

Mempool.prototype.transactionIdsByScriptId = function (scId) {
  let txos = this.__txosListByScriptId(scId)
  let txIdSet = {}

  txos.forEach((txo) => {
    this.spentsFromTxo(txo).forEach(({ txId }) => {
      txIdSet[txId] = true
    })
  })

  txos.forEach(({ txId }) => {
    txIdSet[txId] = true
  })

  return txIdSet
}

Mempool.prototype.__txosListByScriptId = function (scId) {
  return this.scripts[scId] || {}
}

Mempool.prototype.txosByScriptId = function (scId) {
  let txos = this.scripts[scId]
  if (!txos) return {}

  let resultMap = {}
  txos.forEach(({ txId, vout }) => {
    resultMap[`${txId}:${vout}`] = { txId, vout, scId }
  })

  return resultMap
}

Mempool.prototype.txoByTxo = function (txId, vout) {
  return this.txos[`${txId}:${vout}`]
}

module.exports = Mempool
