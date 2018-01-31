let parallel = require('run-parallel')
let typeforce = require('typeforce')
let types = require('./types')
let vstruct = require('varstruct')

let FEEPREFIX = 0x81
let FEETIP = types.tip(FEEPREFIX)
let FEE = {
  keyType: typeforce.compile({
    height: typeforce.UInt32
  }),
  key: vstruct([
    ['prefix', vstruct.Value(vstruct.UInt8, FEEPREFIX)],
    ['height', vstruct.UInt32BE] // big-endian for lexicographical sort
  ]),
  valueType: typeforce.compile({
    iqr: {
      q1: typeforce.UInt53,
      median: typeforce.UInt53,
      q3: typeforce.UInt53
    },
    size: typeforce.UInt32
  }),
  value: vstruct([
    ['iqr', vstruct([
      ['q1', vstruct.UInt64LE],
      ['median', vstruct.UInt64LE],
      ['q3', vstruct.UInt64LE]
    ])],
    ['size', vstruct.UInt32LE]
  ])
}

function FeeIndex () {}

FeeIndex.prototype.tip = function (db, callback) {
  db.get(FEETIP, {}, callback)
}

function box (data) {
  if (data.length === 0) return { q1: 0, median: 0, q3: 0 }
  let quarter = (data.length / 4) | 0
  let midpoint = (data.length / 2) | 0

  return {
    q1: data[quarter],
    median: data[midpoint],
    q3: data[midpoint + quarter]
  }
}

FeeIndex.prototype.connect2ndOrder = function (db, txoIndex, atomic, block, callback) {
  let { height, transactions } = block

  let txTasks = []
  transactions.forEach((tx) => {
    let { ins, outs, vsize } = tx
    let inAccum = 0
    let outAccum = 0
    let txoTasks = []
    let coinbase = false

    ins.forEach((input, vin) => {
      if (coinbase) return
      if (input.coinbase) {
        coinbase = true
        return
      }

      let { prevTxId, vout } = input
      txoTasks.push((next) => {
        txoIndex.txoBy(db, { txId: prevTxId, vout }, (err, txo) => {
          if (err) return next(err)
          if (!txo) return next(new Error(`Missing ${prevTxId}:${vout}`))

          inAccum += txo.value
          next()
        })
      })
    })

    outs.forEach(({ value }, vout) => {
      if (coinbase) return
      outAccum += value
    })

    txTasks.push((next) => {
      if (coinbase) return next(null, 0)

      parallel(txoTasks, (err) => {
        if (err) return next(err)
        let fee = inAccum - outAccum
        let feeRate = Math.floor(fee / vsize)

        next(null, feeRate)
      })
    })
  })

  parallel(txTasks, (err, feeRates) => {
    if (err) return callback(err)
    feeRates = feeRates.sort((a, b) => a - b)

    atomic.put(FEE, { height }, {
      iqr: box(feeRates),
      size: block.strippedsize
    })
    atomic.put(FEETIP, {}, block)

    callback()
  })
}

FeeIndex.prototype.disconnect = function (atomic, block) {
  let { height } = block

  atomic.del(FEE, { height })
  atomic.put(FEETIP, {}, { blockId: block.prevBlockId, height })
}

FeeIndex.prototype.latestFeesFor = function (db, nBlocks, callback) {
  db.get(FEETIP, {}, (err, tip) => {
    if (err) return callback(err)
    if (!tip) return callback(null, [])

    let { height: maxHeight } = tip
    let results = []

    db.iterator(FEE, {
      gte: {
        height: maxHeight - (nBlocks - 1)
      },
      limit: nBlocks
    }, ({ height }, { fees, size }) => {
      results.push({ height, fees, size })
    }, (err) => callback(err, results))
  })
}

module.exports = FeeIndex
module.exports.TYPE = FEE
