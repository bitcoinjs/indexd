let types = require('./types')
let typeforce = require('typeforce')
let vstruct = require('varstruct')
let utils = require('./utils')

let TXINPREFIX = 0x32
let TXINTIP = types.tip(TXINPREFIX)
let TXIN = {
  keyType: typeforce.compile({
    txId: typeforce.HexN(64),
    vout: typeforce.UInt32
  }),
  key: vstruct([
    ['prefix', vstruct.Value(vstruct.UInt8, TXINPREFIX)],
    ['txId', vstruct.String(32, 'hex')],
    ['vout', vstruct.UInt32LE]
  ]),
  valueType: typeforce.compile({
    txId: typeforce.HexN(64),
    vin: typeforce.UInt32
  }),
  value: vstruct([
    ['txId', vstruct.String(32, 'hex')],
    ['vin', vstruct.UInt32LE]
  ])
}

function TxinIndex () {
  this.txins = {}
}

TxinIndex.prototype.tip = function (db, callback) {
  db.get(TXINTIP, {}, callback)
}

TxinIndex.prototype.mempool = function (tx, events) {
  let { txId, ins } = tx

  ins.forEach((input, vin) => {
    if (input.coinbase) return
    let { prevTxId, vout } = input

    utils.getOrSetDefault(this.txins, `${prevTxId}:${vout}`, [])
      .push({ txId, vin })

    if (events) events.push(['txin', `${prevTxId}:${vout}`, txId, vin])
  })
}

TxinIndex.prototype.connect = function (atomic, block, events) {
  let { transactions } = block

  transactions.forEach((tx) => {
    let { txId, ins } = tx

    ins.forEach((input, vin) => {
      if (input.coinbase) return

      let { prevTxId, vout } = input
      atomic.put(TXIN, { txId: prevTxId, vout }, { txId, vin })

      if (events) events.push(['txin', `${prevTxId}:${vout}`, txId, vin])
    })
  })

  atomic.put(TXINTIP, {}, block)
}

TxinIndex.prototype.disconnect = function (atomic, block) {
  let { height, transactions } = block

  transactions.forEach((tx) => {
    let { txId, outs } = tx

    outs.forEach(({ value, vout }) => {
      atomic.del(TXIN, { txId, vout })
    })
  })

  atomic.put(TXINTIP, {}, { blockId: block.prevBlockId, height })
}

// returns a txin { txId, vin } by { txId, vout }
TxinIndex.prototype.txinBy = function (db, txo, callback) {
  let { txId, vout } = txo
  let mem = this.txins[`${txId}:${vout}`]
  if (mem) return callback(null, mem[0]) // XXX: returns first-seen only

  db.get(TXIN, txo, callback)
}

module.exports = TxinIndex
module.exports.types = {
  data: TXIN,
  tip: TXINTIP
}
