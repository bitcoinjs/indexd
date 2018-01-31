let debug = require('./debug')('indexd')
let dbwrapper = require('./dbwrapper')
let { EventEmitter } = require('events')
let parallel = require('run-parallel')
let rpcUtil = require('./rpc')

let FeeIndex = require('./indexes/fee')
let MtpIndex = require('./indexes/mediantime')
let ScriptIndex = require('./indexes/script')
let TxIndex = require('./indexes/tx')
let TxinIndex = require('./indexes/txin')
let TxoIndex = require('./indexes/txo')

function txoToString ({ txId, vout }) {
  return `${txId}:${vout}`
}

function Indexd (db, rpc) {
  this.db = dbwrapper(db)
  this.rpc = rpc
  this.emitter = new EventEmitter() // TODO: bind to this
  this.emitter.setMaxListeners(Infinity)
  this.indexes = {
    fee: new FeeIndex(),
    mtp: new MtpIndex(),
    script: new ScriptIndex(),
    tx: new TxIndex(),
    txin: new TxinIndex(),
    txo: new TxoIndex()
  }
}

Indexd.prototype.tips = function (callback) {
  let tasks = {}

  for (let indexName in this.indexes) {
    let index = this.indexes[indexName]
    tasks[indexName] = (next) => index.tip(this.db, next)
  }

  parallel(tasks, callback)
}

// recurses until `nextBlockId` is falsy
Indexd.prototype.connectFrom = function (prevBlockId, blockId, callback) {
  this.tips((err, tips) => {
    if (err) return callback(err)

    let todo = {}
    for (let indexName in tips) {
      let tip = tips[indexName]
      if (tip && tip.blockId !== prevBlockId) continue
      if (indexName === 'fee') {
        if (!tips.txo) continue
        if (tip && tips.fee.height > tips.txo.height) continue
      }

      todo[indexName] = true
    }

    let todoList = Object.keys(todo)
    if (todoList.length === 0) return callback(new RangeError('Misconfiguration'))

    debug(`Downloading ${blockId} (for ${todoList})`)

    rpcUtil.block(this.rpc, blockId, (err, block) => {
      if (err) return callback(err)

      let atomic = this.db.atomic()
      let events // TODO
      let { height } = block
      debug(`Connecting ${blockId} @ ${height}`)

      // connect block to relevant chain tips
      for (let indexName in todo) {
        let index = this.indexes[indexName]
        if (!index.connect) continue

        index.connect(atomic, block, events)
      }

      atomic.write((err) => {
        if (err) return callback(err)
        debug(`Connected ${blockId} @ ${height}`)

        let self = this
        function loop (err) {
          if (err) return callback(err)
          // recurse until nextBlockId is falsy
          if (!block.nextBlockId) return callback()
          self.connectFrom(blockId, block.nextBlockId, callback)
        }

        if (!todo.fee) return loop()

        debug(`Connecting ${blockId} (2nd Order)`)
        let atomic2 = this.db.atomic()
        this.indexes.fee.connect2ndOrder(this.db, this.indexes.txo, atomic2, block, (err) => {
          if (err) return loop(err)

          debug(`Connected ${blockId} (2nd Order)`)
          atomic2.write(loop)
        })
      })
    })
  })
}

Indexd.prototype.disconnect = function (blockId, callback) {
  debug(`Disconnecting ${blockId}`)

  function fin (err) {
    if (err) return callback(err)
    debug(`Disconnected ${blockId}`)
    callback()
  }

  this.tips((err, tips) => {
    if (err) return fin(err)

    // TODO: fetch lazily
    rpcUtil.block(this.rpc, blockId, (err, block) => {
      if (err) return fin(err)

      let atomic = this.db.atomic()

      // disconnect block from relevant chain tips
      for (let indexName in this.indexes) {
        let index = this.indexes[indexName]
        let tip = tips[indexName]
        if (!tip) continue
        if (tip.blockId !== block.blockId) continue

        index.disconnect(atomic, block)
      }

      atomic.write(fin)
    })
  })
}

Indexd.prototype.__resync = function (done) {
  debug('resynchronizing')

  let self = this
  function fin (err) {
    if (err) return done(err)

    rpcUtil.mempool(self.rpc, (err, txIds) => {
      if (err) return done(err)

      parallel(txIds.map((txId) => (next) => self.notify(txId, next)), done)
    })
  }

  function trySyncFrom (prevBlockId, blockId, confirmations, callback) {
    // reset mempools
    for (let indexName in self.indexes) {
      self.indexes[indexName].constructor()
    }

    // TODO: if confirmations > 100, go fast
    self.connectFrom(prevBlockId, blockId, callback)
  }

  function lowestTip (callback) {
    self.tips((err, tips) => {
      if (err) return callback(err)

      let lowest
      for (let key in tips) {
        let tip = tips[key]
        if (!tip) return callback()
        if (!lowest) lowest = tip
        if (lowest.height < tip.height) continue
        lowest = tip
      }

      callback(null, lowest)
    })
  }

  parallel({
    bitcoind: (f) => rpcUtil.tip(this.rpc, f),
    indexd: (f) => lowestTip(f)
  }, (err, r) => {
    if (err) return fin(err)

    // Step 0, genesis?
    if (!r.indexd) {
      debug('genesis')
      return rpcUtil.blockIdAtHeight(this.rpc, 0, (err, genesisId) => {
        if (err) return fin(err)

        trySyncFrom(null, genesisId, r.bitcoind.height, fin)
      })
    }

    // Step 1, equal?
    debug('...', r)
    if (r.bitcoind.blockId === r.indexd.blockId) return fin()

    // Step 2, is indexd behind? [aka, does bitcoind have the indexd tip]
    rpcUtil.headerJSON(this.rpc, r.indexd.blockId, (err, common) => {
//        if (err && /not found/.test(err.message)) return fin(err) // uh, burn it to the ground
      if (err) return fin(err)

      // forked?
      if (common.confirmations === -1) {
        debug('forked')
        return this.disconnect(r.indexd.blockId, (err) => {
          if (err) return fin(err)

          this.__resync(fin)
        })
      }

      // yes, indexd is behind
      debug('bitcoind is ahead')
      trySyncFrom(common.blockId, common.nextBlockId, common.confirmations, fin)
    })
  })
}

Indexd.prototype.tryResync = function (callback) {
  if (callback) {
    this.emitter.once('resync', callback)
  }

  if (this.syncing) return
  this.syncing = true

  this.__resync((err) => {
    this.syncing = false
    this.emitter.emit('resync', err)
  })
}

Indexd.prototype.notify = function (txId, callback) {
  rpcUtil.transaction(this.rpc, txId, (err, tx) => {
    if (err) return callback(err)

    for (let indexName in this.indexes) {
      let index = this.indexes[indexName]

      if (!index.mempool) continue
      index.mempool(tx)
    }

    callback()
  })
}

// QUERIES
Indexd.prototype.blockIdByTransactionId = function (txId, callback) {
  this.indexes.tx.heightBy(this.db, txId, (err, height) => {
    if (err) return callback(err)
    if (height === -1) return callback()

    rpcUtil.blockIdAtHeight(this.rpc, height, callback)
  })
}

Indexd.prototype.latestFeesForNBlocks = function (nBlocks, callback) {
  this.indexes.fee.latestFeesFor(this.db, nBlocks, callback)
}

// returns a txo { txId, vout, value, script }, by key { txId, vout }
Indexd.prototype.txoByTxo = function (txo, callback) {
  this.indexes.txo.txoBy(this.db, txo, callback)
}

// returns whether (true/false) the script id has even been seen
Indexd.prototype.seenScriptId = function (scId, callback) {
  this.indexes.script.seenScriptId(this.db, scId, callback)
}

// returns a list of txIds with inputs/outputs from/to a { scId, heightRange }
Indexd.prototype.transactionIdsByScriptRange = function (scRange, dbLimit, callback) {
  this.txosByScriptRange(scRange, dbLimit, (err, txos) => {
    if (err) return callback(err)

    let txIdSet = {}
    let tasks = txos.map((txo) => {
      txIdSet[txo.txId] = true
      return (next) => this.indexes.txin.txinBy(this.db, txo, next)
    })

    parallel(tasks, (err, txins) => {
      if (err) return callback(err)

      txins.forEach((txin) => {
        if (!txin) return
        txIdSet[txin.txId] = true
      })

      callback(null, Object.keys(txIdSet))
    })
  })
}

// returns a list of txos { txId, vout, height, value } by { scId, heightRange }
Indexd.prototype.txosByScriptRange = function (scRange, dbLimit, callback) {
  this.indexes.script.txosBy(this.db, scRange, dbLimit, callback)
}

// returns a list of (unspent) txos { txId, vout, height, value }, by { scId, heightRange }
// XXX: despite txo queries being bound by heightRange, the UTXO status is up-to-date
Indexd.prototype.utxosByScriptRange = function (scRange, dbLimit, callback) {
  this.txosByScriptRange(scRange, dbLimit, (err, txos) => {
    if (err) return callback(err)

    let taskMap = {}
    let unspentMap = {}

    txos.forEach((txo) => {
      let txoId = txoToString(txo)
      unspentMap[txoId] = txo
      taskMap[txoId] = (next) => this.indexes.txin.txinBy(this.db, txo, next)
    })

    parallel(taskMap, (err, txinMap) => {
      if (err) return callback(err)

      let unspents = []
      for (let txoId in txinMap) {
        let txin = txinMap[txoId]

        // has a txin, therefore spent
        if (txin) continue

        unspents.push(unspentMap[txoId])
      }

      callback(null, unspents)
    })
  })
}

module.exports = Indexd
