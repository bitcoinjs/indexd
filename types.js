let typeforce = require('typeforce')
let vstruct = require('varstruct')

let Hex64 = vstruct.String(32, 'hex')
let Hex64t = typeforce.HexN(64)
let blockId = Hex64
let txId = Hex64
let scId = Hex64
let height = vstruct.UInt32BE // big-endian for lexicographical sort
let vout = vstruct.UInt32LE
let satoshis = vstruct.UInt64LE

let tip = {
  keyType: {},
  key: vstruct([
    ['prefix', vstruct.Value(vstruct.UInt8, 0x00)]
  ]),
  valueType: Hex64t,
  value: blockId
}

let scIndex = {
  keyType: typeforce.compile({
    scId: Hex64t,
    height: typeforce.UInt32,
    txId: Hex64t,
    vout: typeforce.UInt32
  }),
  key: vstruct([
    ['prefix', vstruct.Value(vstruct.UInt8, 0x01)],
    ['scId', scId],
    ['height', height],
    ['txId', txId],
    ['vout', vout]
  ]),
  valueType: typeforce.Null,
  value: null
}

let spentIndex = {
  keyType: typeforce.compile({
    txId: Hex64t,
    vout: typeforce.UInt32
  }),
  key: vstruct([
    ['prefix', vstruct.Value(vstruct.UInt8, 0x02)],
    ['txId', txId],
    ['vout', vout]
  ]),
  valueType: typeforce.compile({
    txId: Hex64t,
    vin: typeforce.UInt32
  }),
  value: vstruct([
    ['txId', txId],
    ['vin', vout]
  ])
}

let txIndex = {
  keyType: typeforce.compile({
    txId: Hex64t
  }),
  key: vstruct([
    ['prefix', vstruct.Value(vstruct.UInt8, 0x03)],
    ['txId', txId]
  ]),
  valueType: typeforce.compile({
    height: typeforce.UInt32
  }),
  value: vstruct([
    ['height', height]
  ])
}

let txoIndex = {
  keyType: typeforce.compile({
    txId: Hex64t,
    vout: typeforce.UInt32
  }),
  key: vstruct([
    ['prefix', vstruct.Value(vstruct.UInt8, 0x04)],
    ['txId', txId],
    ['vout', vout]
  ]),
  valueType: typeforce.compile({
    value: typeforce.UInt53
  }),
  value: vstruct([
    ['value', satoshis]
  ])
}

// TODO
// let feeIQR = vstruct([
//   ['q1', satoshis],
//   ['median', satoshis],
//   ['q3', satoshis]
// ])
// let fees = {
//   prefix: 0x11,
//   key: vstruct([
//     ['prefix', vstruct.Value(vstruct.UInt8, 0x11)],
//     ['height', height],
//   ]),
//   value: vstruct([
//     ['size', vstruct.UInt32LE],
//     ['fees', feeIQR]
//   ])
// }

module.exports = {
  scIndex,
  spentIndex,
  txIndex,
  txoIndex,
  tip
}
