let crypto = require('crypto')
let debug = require('./debug')('indexd:rpc')

function rpcd (rpc, method, params, done) {
  rpc(method, params, (err, result) => {
    if (err) debug(method, params, err)
    if (err) return done(err)

    done(null, err)
  })
}

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
    delete output.scriptPubKey
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

function block (rpc, blockId, done) {
  rpcd(rpc, 'getblock', [blockId, 2], (err, block) => {
    if (err) return done(err)

    block.transactions = block.tx.map(t => augment(t))
    delete block.tx
    done(null, block)
  })
}

function blockIdAtHeight (rpc, height, done) {
  rpcd(rpc, 'getblockhash', [height], (err, blockId) => {
    if (err) return done(err)
    if (!blockId) return done(new Error(`Missing block at ${height}`))
    done(null, blockId)
  })
}

function header (rpc, blockId, done) {
  rpcd(rpc, 'getblockheader', [blockId, false], (err, hex) => {
    if (err) return done(err)

    done(null, Buffer.from(hex, 'hex'))
  })
}

function headerJSON (rpc, blockId, done) {
  rpcd(rpc, 'getblockheader', [blockId, true], (err, hex) => {
    if (err) return done(err)

    done(null, Buffer.from(hex, 'hex'))
  })
}

function mempool (rpc, done) {
  rpcd(rpc, 'getrawmempool', [false], done)
}

function tip (rpc, done) {
  rpcd(rpc, 'getbestblockhash', [], done)
}

function transaction (rpc, txId, next, forgiving) {
  rpcd(rpc, 'getrawtransaction', [txId, true], (err, tx) => {
    if (err) {
      if (forgiving && /No such mempool or blockchain transaction/.test(err)) return next()
      return next(err)
    }

    next(null, augment(tx))
  })
}

module.exports = {
  block,
  blockIdAtHeight,
  header,
  headerJSON,
  mempool,
  tip,
  transaction
}
