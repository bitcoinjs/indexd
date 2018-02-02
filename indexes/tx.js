let types = require('./types')
let typeforce = require('typeforce')
let vstruct = require('varstruct')

let TXPREFIX = 0x35
let TXTIP = types.tip(TXPREFIX)
let TX = {
  keyType: typeforce.compile({
    txId: typeforce.HexN(64)
  }),
  key: vstruct([
    ['prefix', vstruct.Value(vstruct.UInt8, TXPREFIX)],
    ['txId', vstruct.String(32, 'hex')]
  ]),
  valueType: typeforce.compile({
    height: typeforce.UInt32
  }),
  value: vstruct([
    ['height', vstruct.UInt32LE]
  ])
}

function TxIndex () {
  this.txs = {}
}

TxIndex.prototype.tip = function (db, callback) {
  db.get(TXTIP, {}, callback)
}

TxIndex.prototype.mempool = function (tx, events) {
  let { txId } = tx

  this.txs[txId] = true
}

TxIndex.prototype.connect = function (atomic, block, events) {
  let { height, transactions } = block

  transactions.forEach((tx) => {
    let { txId } = tx
    atomic.put(TX, { txId }, { height })
  })

  atomic.put(TXTIP, {}, block)
}

TxIndex.prototype.disconnect = function (atomic, block) {
  let { height, transactions } = block

  transactions.forEach((tx) => {
    let { txId } = tx

    atomic.del(TX, { txId })
  })

  atomic.put(TXTIP, {}, { blockId: block.prevBlockId, height })
}

// returns the height (-1 if unconfirmed, null if unknown) of a transaction, by txId
TxIndex.prototype.heightBy = function (db, txId, callback) {
  let mem = this.txs[txId]
  if (mem) return callback(null, -1)

  db.get(TX, txId, (err, result) => {
    if (err) return callback(err)
    if (!result) return callback(null, null)

    callback(null, result.height)
  })
}

module.exports = TxIndex
module.exports.types = {
  data: TX,
  tip: TXTIP
}
