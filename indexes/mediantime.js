let typeforce = require('typeforce')
let types = require('./types')
let vstruct = require('varstruct')

let MTPPREFIX = 0x83
let MTPTIP = types.tip(MTPPREFIX)
let MTP = {
  keyType: typeforce.compile({
    medianTime: typeforce.UInt32,
    height: typeforce.UInt32
  }),
  key: vstruct([
    ['prefix', vstruct.Value(vstruct.UInt8, MTPPREFIX)],
    ['medianTime', vstruct.UInt32BE], // big-endian for lexicographical sort
    ['height', vstruct.UInt32LE]
  ]),
  valueType: typeforce.Null
}

function MtpIndex () {}

MtpIndex.prototype.tip = function (db, callback) {
  db.get(MTPTIP, {}, callback)
}

MtpIndex.prototype.connect = function (atomic, block) {
  let { height, medianTime } = block

  atomic.put(MTP, { medianTime, height })
  atomic.put(MTPTIP, {}, block)
}

MtpIndex.prototype.disconnect = function (atomic, block) {
  let { height, medianTime } = block

  atomic.del(MTP, { medianTime, height })
  atomic.put(MTPTIP, {}, { blockId: block.prevBlockId, height })
}

module.exports = MtpIndex
module.exports.types = {
  data: MTP,
  tip: MTPTIP
}
