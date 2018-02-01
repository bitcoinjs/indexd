let typeforce = require('typeforce')
let vstruct = require('varstruct')

function tip (prefix) {
  return {
    keyType: {},
    key: vstruct([
      ['prefix', vstruct.Value(vstruct.UInt8, prefix)]
    ]),
    valueType: {
      blockId: typeforce.HexN(64),
      height: typeforce.UInt32
    },
    value: vstruct([
      ['blockId', vstruct.String(32, 'hex')],
      ['height', vstruct.UInt32LE]
    ])
  }
}

module.exports = { tip }
