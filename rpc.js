let crypto = require('crypto')
let debug = require('./debug')('indexd:rpc')

function rpcd (rpc, method, params, done) {
  debug(method, params)
  rpc(method, params, (err, result) => {
    if (err) debug(method, params, err)
    if (err) return done(err)

    done(null, result)
  })
}

function sha256 (hex) {
  return crypto.createHash('sha256')
    .update(Buffer.from(hex, 'hex'))
    .digest('hex')
}

function augment (tx) {
//    tx.txBuffer = Buffer.from(tx.hex, 'hex')
  delete tx.hex
  tx.txId = tx.txid
  delete tx.txid
  tx.vin.forEach((input) => {
    input.prevTxId = input.txid
    delete input.txid
  })
  tx.vout.forEach((output) => {
    output.script = Buffer.from(output.scriptPubKey.hex, 'hex')
    delete output.scriptPubKey
    output.scId = sha256(output.script)
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

    block.blockId = blockId
    delete block.hash
    block.nextBlockId = block.nextblockhash
    delete block.nextblockhash
    block.prevBlockId = block.previousblockhash
    delete block.prevblockhash

    block.transactions = block.tx.map(t => augment(t))
    delete block.tx

    done(null, block)
  })
}

function blockIdAtHeight (rpc, height, done) {
  rpcd(rpc, 'getblockhash', [height], done)
}

function headerJSON (rpc, blockId, done) {
  rpcd(rpc, 'getblockheader', [blockId, true], (err, header) => {
    if (err) return done(err)

    header.blockId = blockId
    delete header.hash
    header.nextBlockId = header.nextblockhash
    delete header.nextblockhash

    done(null, header)
  })
}

function mempool (rpc, done) {
  rpcd(rpc, 'getrawmempool', [false], done)
}

function tip (rpc, done) {
  rpcd(rpc, 'getchaintips', [], (err, tips) => {
    if (err) return done(err)

    let {
      hash: blockId,
      height
    } = tips.filter(x => x.status === 'active').pop()

    done(null, { blockId, height })
  })
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
  headerJSON,
  mempool,
  tip,
  transaction
}
