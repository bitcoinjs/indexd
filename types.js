let typeforce = require('typeforce')
let tfHex64 = typeforce.HexN(64)

let vstruct = require('varstruct')
let Hex64 = vstruct.String(32, 'hex')
let vout = vstruct.UInt32LE
let satoshis = vstruct.UInt64LE

let tip = {
  keyType: {},
  key: vstruct([
    ['prefix', vstruct.Value(vstruct.UInt8, 0x00)]
  ]),
  valueType: {
    blockId: tfHex64,
    height: typeforce.UInt32
  },
  value: vstruct([
    ['blockId', Hex64],
    ['height', vstruct.UInt32LE]
  ])
}

let scIndex = {
  keyType: typeforce.compile({
    scId: tfHex64,
    height: typeforce.UInt32,
    txId: tfHex64,
    vout: typeforce.UInt32
  }),
  key: vstruct([
    ['prefix', vstruct.Value(vstruct.UInt8, 0x01)],
    ['scId', Hex64],
    ['height', vstruct.UInt32BE], // big-endian for lexicographical sort
    ['txId', Hex64],
    ['vout', vout]
  ]),
  valueType: typeforce.Null,
  value: null
}

let spentIndex = {
  keyType: typeforce.compile({
    txId: tfHex64,
    vout: typeforce.UInt32
  }),
  key: vstruct([
    ['prefix', vstruct.Value(vstruct.UInt8, 0x02)],
    ['txId', Hex64],
    ['vout', vout]
  ]),
  valueType: typeforce.compile({
    txId: tfHex64,
    vin: typeforce.UInt32
  }),
  value: vstruct([
    ['txId', Hex64],
    ['vin', vout]
  ])
}

let txIndex = {
  keyType: typeforce.compile({
    txId: tfHex64
  }),
  key: vstruct([
    ['prefix', vstruct.Value(vstruct.UInt8, 0x03)],
    ['txId', Hex64]
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
    txId: tfHex64,
    vout: typeforce.UInt32
  }),
  key: vstruct([
    ['prefix', vstruct.Value(vstruct.UInt8, 0x04)],
    ['txId', Hex64],
    ['vout', vout]
  ]),
  valueType: typeforce.compile({
    value: typeforce.UInt53,
    script: typeforce.Buffer
  }),
  value: vstruct([
    ['value', satoshis],
    ['script', vstruct.VarBuffer(vstruct.UInt16LE)]
  ])
}

// TODO: remove in 0.9.0, superceded by above, for backwards compat only
let txoIndexOld = {
  keyType: typeforce.compile({
    txId: tfHex64,
    vout: typeforce.UInt32
  }),
  key: vstruct([
    ['prefix', vstruct.Value(vstruct.UInt8, 0x04)],
    ['txId', Hex64],
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
  keyType: typeforce.compile({
    height: typeforce.UInt32
  }),
  key: vstruct([
    ['prefix', vstruct.Value(vstruct.UInt8, 0x11)],
    ['height', vstruct.UInt32BE] // big-endian for lexicographical sort
  ]),
  valueType: typeforce.compile({
    size: typeforce.UInt32,
    fees: {
      q1: typeforce.UInt53,
      median: typeforce.UInt53,
      q3: typeforce.UInt53
    }
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
  txoIndexOld,
  tip
}
