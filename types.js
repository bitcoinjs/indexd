let vstruct = require('varstruct')

let NOTHING = vstruct.Buffer(0)
let Hex64 = vstruct.String(32, 'hex')
let blockId = Hex64
let txId = Hex64
let scId = Hex64
let height = vstruct.UInt32BE // big-endian for lexicographical sort
let vout = vstruct.UInt32LE
let satoshis = vstruct.UInt64LE

let tip = {
  key: vstruct([
    ['prefix', vstruct.Value(vstruct.UInt8, 0x00)]
  ]),
  value: blockId
}

let scIndex = {
  key: vstruct([
    ['prefix', vstruct.Value(vstruct.UInt8, 0x01)],
    ['scId', scId],
    ['height', height],
    ['txId', txId],
    ['vout', vout]
  ]),
  value: NOTHING
}

let spentIndex = {
  key: vstruct([
    ['prefix', vstruct.Value(vstruct.UInt8, 0x02)],
    ['txId', txId],
    ['vout', vout]
  ]),
  value: vstruct([
    ['txId', txId],
    ['vin', vout]
  ])
}

let txIndex = {
  key: vstruct([
    ['prefix', vstruct.Value(vstruct.UInt8, 0x03)],
    ['txId', txId]
  ]),
  value: vstruct([
    ['height', height]
  ])
}

let txOutIndex = {
  key: vstruct([
    ['prefix', vstruct.Value(vstruct.UInt8, 0x04)],
    ['txId', txId],
    ['vout', vout]
  ]),
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
  txOutIndex,
  tip
}

// convert prefixs to keys
for (let key in module.exports) {
  let _export = module.exports[key]
  let prefix = Buffer.alloc(1)
  prefix.writeUInt8(_export.prefix)
  _export.prefix = prefix
}
