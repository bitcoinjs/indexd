let crypto = require('crypto')
let types = require('./types')
let typeforce = require('typeforce')
let vstruct = require('varstruct')
let utils = require('./utils')

let SCRIPTPREFIX = 0x33
let SCRIPTTIP = types.tip(SCRIPTPREFIX)
let SCRIPT = {
  keyType: typeforce.compile({
    scId: typeforce.HexN(64),
    height: typeforce.UInt32,
    txId: typeforce.HexN(64),
    vout: typeforce.UInt32
  }),
  key: vstruct([
    ['prefix', vstruct.Value(vstruct.UInt8, SCRIPTPREFIX)],
    ['scId', vstruct.String(32, 'hex')],
    ['height', vstruct.UInt32BE], // big-endian for lexicographical sort
    ['txId', vstruct.String(32, 'hex')],
    ['vout', vstruct.UInt32LE]
  ]),
  valueType: typeforce.compile({
    value: typeforce.UInt53
  }),
  value: vstruct([
    ['value', vstruct.UInt64LE]
  ])
}

function sha256 (buffer) {
  return crypto.createHash('sha256')
    .update(buffer)
    .digest('hex')
}

function ScriptIndex () {
  this.scripts = {}
}

ScriptIndex.prototype.tip = function (db, callback) {
  db.get(SCRIPTTIP, {}, callback)
}

ScriptIndex.prototype.mempool = function (tx, events) {
  let { txId, outs } = tx

  outs.forEach(({ vout, script, value }) => {
    let scId = sha256(script)
    utils.getOrSetDefault(this.scripts, scId, [])
      .push({ txId, vout, height: -1, value })

    if (events) events.push(['script', scId, null, txId, vout, value])
  })
}

ScriptIndex.prototype.connect = function (atomic, block, events) {
  let { height, transactions } = block

  transactions.forEach((tx) => {
    let { txId, outs } = tx

    outs.forEach(({ vout, script, value }) => {
      let scId = sha256(script)
      atomic.put(SCRIPT, { scId, height, txId, vout }, { value })

      if (events) events.push(['script', scId, height, txId, vout, value])
    })
  })

  atomic.put(SCRIPTTIP, {}, block)
}

ScriptIndex.prototype.disconnect = function (atomic, block) {
  let { height, transactions } = block

  transactions.forEach((tx) => {
    let { txId, outs } = tx

    outs.forEach(({ vout, script }) => {
      let scId = sha256(script)
      atomic.del(SCRIPT, { scId, height, txId, vout })
    })
  })

  atomic.put(SCRIPTTIP, {}, { blockId: block.prevBlockId, height })
}

let ZERO64 = '0000000000000000000000000000000000000000000000000000000000000000'
let MAX64 = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'

// returns the height at scId was first-seen (-1 if unconfirmed, null if unknown)
ScriptIndex.prototype.firstSeenScriptId = function (db, scId, callback) {
  let result = null
  db.iterator(SCRIPT, {
    gte: { scId, height: 0, txId: ZERO64, vout: 0 },
    lt: { scId, height: 0xffffffff, txId: ZERO64, vout: 0 },
    limit: 1
  }, ({ height }) => {
    result = height
  }, (err) => {
    if (err) return callback(err)
    if (result !== null) return callback(null, result)

    let mem = this.scripts[scId]
    if (mem) return callback(null, -1)
    callback(null, null)
  })
}

// XXX: if heightRange distance is < 2, the limit is ignored
//   -- could be rectified by supporting a minimum txId value (aka, last retrieved)
//
// returns a list of { txId, vout, height, value } by { scId, heightRange: [from, to] }
ScriptIndex.prototype.txosBy = function (db, { scId, heightRange, mempool }, maxRows, callback) {
  let [fromHeight, toHeight] = heightRange
  let distance = toHeight - fromHeight
  if (distance < 0) return callback(null, [])
  if (distance < 2) maxRows = Infinity
  fromHeight = Math.min(Math.max(0, fromHeight), 0xffffffff)
  toHeight = Math.min(Math.max(0, toHeight), 0xffffffff)

  let results = []
  if (mempool && (scId in this.scripts)) {
    results = this.scripts[scId].concat()
  }

  db.iterator(SCRIPT, {
    gte: { scId, height: fromHeight, txId: ZERO64, vout: 0 },
    lt: { scId, height: toHeight, txId: MAX64, vout: 0xffffffff },
    limit: maxRows + 1
  }, ({ height, txId, vout }, { value }, __iterator) => {
    results.push({
      txId, vout, height, value
    })

    if (results.length > maxRows) return __iterator.end((err) => callback(err || new RangeError('Exceeded Limit')))
  }, (err) => callback(err, results))
}

module.exports = ScriptIndex
module.exports.types = {
  data: SCRIPT,
  tip: SCRIPTTIP
}
