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

function ScriptIndex () {
  this.scripts = {}
}

ScriptIndex.prototype.tip = function (db, callback) {
  db.get(SCRIPTTIP, {}, callback)
}

ScriptIndex.prototype.mempool = function (tx, events) {
  let { txId, outs } = tx

  outs.forEach(({ scId, value, vout }) => {
    utils.getOrSetDefault(this.scripts, scId, [])
      .push({ txId, value, vout })

    if (events) events.push(['script', scId, null, txId, vout, value])
  })
}

ScriptIndex.prototype.connect = function (atomic, block, events) {
  let { height, transactions } = block

  transactions.forEach((tx) => {
    let { txId, outs } = tx

    outs.forEach(({ scId, value, vout }) => {
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

    outs.forEach(({ scId, vout }) => {
      atomic.del(SCRIPT, { scId, height, txId, vout })
    })
  })

  atomic.put(SCRIPTTIP, {}, { blockId: block.prevBlockId, height })
}

let ZERO64 = '0000000000000000000000000000000000000000000000000000000000000000'
let MAX64 = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'

// returns true/false if scId is known
ScriptIndex.prototype.seenScriptId = function (db, scId, callback) {
  let mem = this.scripts[scId]
  if (mem) return callback(null, true)

  let result = false
  db.iterator(SCRIPT, {
    gte: { scId, height: 0, txId: ZERO64, vout: 0 },
    lt: { scId, height: 0xffffffff, txId: ZERO64, vout: 0 },
    limit: 1
  }, () => {
    result = true
  }, (err) => callback(err, result))
}

// XXX: maxRows defaults to 440, but a FULL block on average contains 4400 txos
// thereby if heightRange distance is < 2, the limit is ignored
//
// returns a list of { txId, vout, height, value } by { scId, heightRange: [from, to] }
ScriptIndex.prototype.txosBy = function (db, { scId, heightRange }, maxRows, callback) {
  maxRows = maxRows || 440
  let [fromHeight, toHeight] = heightRange
  let distance = toHeight - fromHeight
  if (distance < 0) return callback(null, [])
  if (distance < 2) maxRows = Infinity

  let results = []
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
module.exports.TYPE = SCRIPT
