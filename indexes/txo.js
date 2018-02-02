let types = require('./types')
let typeforce = require('typeforce')
let varuint = require('varuint-bitcoin')
let vstruct = require('varstruct')

let TXOPREFIX = 0x34
let TXOTIP = types.tip(TXOPREFIX)
let TXO = {
  keyType: typeforce.compile({
    txId: typeforce.HexN(64),
    vout: typeforce.UInt32
  }),
  key: vstruct([
    ['prefix', vstruct.Value(vstruct.UInt8, TXOPREFIX)],
    ['txId', vstruct.String(32, 'hex')],
    ['vout', vstruct.UInt32LE]
  ]),
  valueType: typeforce.compile({
    value: typeforce.UInt53,
    script: typeforce.Buffer
  }),
  value: vstruct([
    ['value', vstruct.UInt64LE],
    ['script', vstruct.VarBuffer(varuint)]
  ])
}

function TxoIndex () {
  this.txos = {}
}

TxoIndex.prototype.tip = function (db, callback) {
  db.get(TXOTIP, {}, callback)
}

TxoIndex.prototype.mempool = function (tx) {
  let { txId, outs } = tx

  outs.forEach(({ script, value, vout }) => {
    this.txos[`${txId}:${vout}`] = { script, value }
  })
}

TxoIndex.prototype.connect = function (atomic, block) {
  let { transactions } = block

  transactions.forEach((tx) => {
    let { txId, outs } = tx

    outs.forEach(({ script, value, vout }) => {
      atomic.put(TXO, { txId, vout }, { value, script })
    })
  })

  atomic.put(TXOTIP, {}, block)
}

TxoIndex.prototype.disconnect = function (atomic, block) {
  let { height, transactions } = block

  transactions.forEach((tx) => {
    let { txId, outs } = tx

    outs.forEach(({ value, vout }) => {
      atomic.del(TXO, { txId, vout })
    })
  })

  atomic.put(TXOTIP, {}, { blockId: block.prevBlockId, height })
}

// returns a txo { txId, vout, value, script } by { txId, vout }
TxoIndex.prototype.txoBy = function (db, txo, callback) {
  let { txId, vout } = txo
  let mem = this.txos[`${txId}:${vout}`]
  if (mem) return callback(null, mem)

  db.get(TXO, txo, callback)
}

module.exports = TxoIndex
module.exports.TYPE = TXO
