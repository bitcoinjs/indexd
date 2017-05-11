let bitcoin = require('bitcoinjs-lib')
let debug = require('debug')('mempool')
let parallel = require('run-parallel')

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
  this.rpc('getrawtransaction', [txId, 0], (err, txHex) => {
    if (err && /No such mempool or blockchain transaction/.test(err)) {
      debug(`${txId} dropped`)
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

      setTimeout(() => this.emitter.emit('spent', `${prevTxId}:${vout}`, txId, txBuffer))
    })

    tx.outs.forEach(({ script, value }, vout) => {
      let scId = bitcoin.crypto.sha256(script).toString('hex')

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
  })
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
  this.rpc('getrawmempool', [false], (err, actualTxIds) => {
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
Mempool.prototype.knownScript = function (scId) {
  return Boolean(this.scripts[scId])
}

Mempool.prototype.spentsFromTxo = function ({ txId, vout }) {
  return this.spents[`${txId}:${vout}`] || []
}

Mempool.prototype.txosByScript = function (scId) {
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

Mempool.prototype.transactionsByScript = function (scId) {
  let txosMap = this.txosByScript(scId)
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

module.exports = Mempool
