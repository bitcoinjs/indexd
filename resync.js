let debug = require('./debug')('indexd:resync')
let parallel = require('run-parallel')
let rpcUtil = require('./rpc')

// recursively calls connectBlock(id) until `bitcoind[id].next` is falsy
function connectBlock (rpc, indexd, id, height, callback) {
  debug(`Connecting ${id} @ ${height}`)

  indexd.connect(id, height, (err, nextblockhash) => {
    if (err) return callback(err)

    debug(`Connected ${id} @ ${height}`)
    if (!nextblockhash) return callback()

    // recurse until next is falsy
    connectBlock(rpc, indexd, nextblockhash, height + 1, callback)
  })
}

function disconnectBlock (indexd, id, callback) {
  debug(`Disconnecting ${id}`)

  indexd.disconnect(id, (err) => {
    if (err) return callback(err)

    debug(`Disconnected ${id}`)
    callback()
  })
}

module.exports = function resync (rpc, indexd, callback) {
  debug('fetching bitcoind/indexd tips')

  parallel({
    bitcoind: (f) => rpcUtil.tip(rpc, f),
    indexd: (f) => indexd.tip(f)
  }, (err, tips) => {
    if (err) return callback(err)

    // Step 0, genesis?
    if (!tips.indexd) {
      debug('genesis')
      return rpcUtil.blockIdAtHeight(rpc, 0, (err, genesisId) => {
        if (err) return callback(err)

        connectBlock(rpc, indexd, genesisId, 0, callback)
      })
    }

    // Step 1, equal?
    debug('...', tips)
    if (tips.bitcoind === tips.indexd) return callback()

    // else, Step 2, is indexd behind? [bitcoind has indexd tip]
    rpcUtil.headerJSON(rpc, tips.indexd, (err, common) => {
      // not in bitcoind chain? [forked]
      if (
        (err && err.message === 'Block not found') ||
        (!err && common.confirmations === -1)
      ) {
        debug('indexd is forked')
        return disconnectBlock(indexd, tips.indexd, (err) => {
          if (err) return callback(err)

          resync(rpc, indexd, callback)
        })
      }
      if (err) return callback(err)

      // indexd is behind
      debug('bitcoind is ahead')
      connectBlock(rpc, indexd, common.nextblockhash, common.height + 1, callback)
    })
  })
}
