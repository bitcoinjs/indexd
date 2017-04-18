let typeforce = require('typeforce')
let vstruct = require('varstruct')

let Hex64 = vstruct.String(32, 'hex')
let Hex64t = typeforce.HexN(64)
let blockId = Hex64
let txId = Hex64
let scId = Hex64
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
    ['height', vstruct.UInt32BE], // big-endian for lexicographical sort
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
    ['height', vstruct.UInt32LE]
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

let feeIndex = {
  prefix: 0x11,
  keyType: typeforce.compile({
    height: typeforce.UInt32
  }),
  key: vstruct([
    ['prefix', vstruct.Value(vstruct.UInt8, 0x11)],
    ['height', vstruct.UInt32BE] // big-endian for lexicographical sort
  ]),
  valueType: typeforce.compile({
    fees: {
      q1: typeforce.UInt53,
      median: typeforce.UInt53,
      q3: typeforce.UInt53
    },
    size: typeforce.UInt32
  }),
  value: vstruct([
    ['size', vstruct.UInt32LE],
    ['fees', vstruct([
      ['q1', satoshis],
      ['median', satoshis],
      ['q3', satoshis]
    ])]
  ])
}

module.exports = {
  feeIndex,
  scIndex,
  spentIndex,
  txIndex,
  txoIndex,
  tip
}
