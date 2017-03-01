let bytes = require('bytes')
let types = require('../types')

// constants
let multiplier = 1
let nTransactions = 200000000 * multiplier
// let nUTXOS = 46000000 * multiplier
let nBlocks = 460000 * multiplier
let inputsPerTx = 2.1
let outputsPerTx = 2.4
// let transactionsPerBlock = nTransactions / nBlocks
// let scriptsPerBlock = transactionsPerBlock * outputsPerTx
// let spentRatio = (nTransactions - nUTXOS) / nTransactions
//
let hex64 = Buffer.alloc(32).fill(0).toString('hex')
let height = 0
let vout = 0
let blockId = hex64
let txId = hex64
let scId = hex64
let txProx = 0
let scProx = 0
let value = 0
let fees = { q1: 0, q2: 0, q3: 0 }
let size = 0
let vin = 0
let all = { height, vout, blockId, txId, scId, txProx, scProx, value, fees, size, vin }

function typeSize (type) {
  return 12 + type.key.encodingLength(all) + type.value.encodingLength(all)
}

console.log('Default', bytes(
  typeSize(types.tip) +
  (nTransactions * (
    typeSize(types.txIndex) +

    (inputsPerTx * (
      typeSize(types.spentIndex) +
      0
    )) +

    (outputsPerTx * (
      typeSize(types.txOutIndex) +
      typeSize(types.scIndex) +
      0
    ))
  ))
))
