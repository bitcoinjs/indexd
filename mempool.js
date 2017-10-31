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
  rpcUtil(this.rpc, (err, actualTxIds) => {
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
  let txosMap = this.txosByScriptId(scId)
  let spentsMap = {}

  for (let txoKey in txosMap) {
    let txo = txosMap[txoKey]
    spentsMap[txoKey] = this.spentsFromTxo(txo)
  }

  let txIds = {}

  for (let x in spentsMap) {
    let spents = spentsMap[x]
    if (!spents) continue

    spents.forEach(({ txId }) => {
      txIds[txId] = true
    })
  }

  for (let x in txosMap) {
    let { txId } = txosMap[x]
    txIds[txId] = true
  }

  return txIds
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
