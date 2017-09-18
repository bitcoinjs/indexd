let crypto = require('crypto')

function sha256 (hex) {
  return crypto.createHash('sha256')
    .update(Buffer.from(hex, 'hex'))
    .digest('hex')
}

function augment (tx) {
  tx.txBuffer = Buffer.from(tx.hex, 'hex')
  delete tx.hex
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
  return tx
}

function transaction (rpc, txId, next, forgiving) {
  rpc('getrawtransaction', [txId, true], (err, tx) => {
    if (err) {
      if (forgiving && /No such mempool or blockchain transaction/.test(err)) return next()
      return next(err)
    }

    next(null, augment(tx))
  })
}

function block (rpc, blockId, done) {
  rpc('getblock', [blockId, 2], (err, block) => {
    if (err) return done(err)

    block.transactions = block.tx.map(t => augment(t))
    delete block.tx
    done(err, block)
  })
}

function header (rpc, blockId, done) {
  rpc('getblockheader', [blockId, false], (err, hex) => {
    if (err) return done(err)

    done(null, Buffer.from(hex, 'hex'))
  })
}

module.exports = { block, header, transaction }
