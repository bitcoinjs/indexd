let vstruct = require('varstruct')

let NOTHING = vstruct.Buffer(0)
let Hex64 = vstruct.String(32, 'hex')
let blockId = Hex64
let txId = Hex64
let scId = Hex64
let height = vstruct.UInt32BE // big-endian for lexicographical sort
let vout = vstruct.UInt32LE
let satoshis = vstruct.DoubleLE

let tip = {
  prefix: 0x00,
  key: NOTHING,
  value: blockId
}

let scIndex = {
  prefix: 0x01,
  key: vstruct([
    ['scId', scId],
    ['height', height],
    ['txId', txId],
    ['vout', vout]
  ]),
  value: NOTHING
}

let spentIndex = {
  prefix: 0x02,
  key: vstruct([
    ['txId', txId],
    ['vout', vout]
  ]),
  value: vstruct([
    ['txId', txId],
    ['vin', vout]
  ])
}

let txIndex = {
  prefix: 0x03,
  key: txId,
  value: vstruct([
    ['height', height]
  ])
}

let txOutIndex = {
  prefix: 0x04,
  key: vstruct([
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
//   key: height,
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
