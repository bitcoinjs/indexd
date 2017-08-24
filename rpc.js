let crypto = require('crypto')
let parallel = require('run-parallel')

function sha256 (hex) {
  return crypto.createHash('sha256')
    .update(Buffer.from(hex, 'hex'))
    .digest('hex')
}

function transaction (rpc, txId, next, forgiving) {
  rpc('getrawtransaction', [txId, false], (err, txHex) => {
    if (err) {
      if (forgiving && /No such mempool or blockchain transaction/.test(err)) return next()
      return next(err)
    }

    rpc('decoderawtransaction', [txHex], (err, tx) => {
      if (err) return next(err)

      tx.txBuffer = Buffer.from(txHex, 'hex')
      tx.txId = tx.txid
      delete tx.txid
      tx.vin.forEach((input) => {
        input.prevTxId = input.txid
        delete input.txid
      })
      tx.vout.forEach((output) => {
        output.scId = sha256(output.scriptPubKey.hex)
        output.value = Math.round(output.value * 1e8)
        output.vout = output.n
        delete output.n
      })
      tx.ins = tx.vin
      tx.outs = tx.vout
      delete tx.vin
      delete tx.vout
      next(null, tx)
    })
  })
}

function block (rpc, blockId, done, forgiving) {
  rpc('getblock', [blockId, true], (err, block) => {
    if (err) return done(err)

    block.transactions = []
    parallel(block.tx.map((txId) => {
      return (next) => transaction(rpc, txId, next, forgiving)
    }), (err) => {
      if (err) return done(err)
      delete block.tx
      done(err, block)
    })
  })
}

module.exports = { block, transaction }
