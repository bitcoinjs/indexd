let debug = require('./debug')('indexd:resync')
let parallel = require('run-parallel')
let rpcUtil = require('./rpc')

// recursively calls connectBlock(id) until `bitcoind[id].next` is falsy
function connectBlock (rpc, local, id, height, callback) {
  debug(`Connecting ${id} @ ${height}`)

  rpcUtil.headerJSON(rpc, id, (err, header) => {
    if (err) return callback(err)
    if (header.height !== height) return callback(new Error('Height mismatch'))

    local.connect(id, height, (err) => {
      if (err) return callback(err)

      debug(`Connected ${id} @ ${height}`)
      if (!header.nextblockhash) return callback()

      // recurse until next is falsy
      connectBlock(rpc, local, header.nextblockhash, height + 1, callback)
    })
  })
}

function disconnectBlock (local, id, callback) {
  debug(`Disconnecting ${id}`)

  local.disconnect(id, (err) => {
    if (err) return callback(err)

    debug(`Disconnected ${id}`)
    callback()
  })
}

module.exports = function resync (rpc, local, callback) {
  debug('fetching bitcoind/local tips')

  parallel({
    bitcoind: (f) => rpcUtil.tip(rpc, f),
    local: (f) => local.tip(f)
  }, (err, tips) => {
    if (err) return callback(err)

    // Step 0, genesis?
    if (!tips.local) {
      debug('genesis')
      return rpcUtil.blockIdAtHeight(rpc, 0, (err, genesisId) => {
        if (err) return callback(err)

        connectBlock(rpc, local, genesisId, 0, callback)
      })
    }

    // Step 1, equal?
    debug('...', tips)
    if (tips.bitcoind === tips.local) return callback()

    // else, Step 2, is local behind? [bitcoind has local tip]
    rpcUtil.headerJSON(tips.local, (err, common) => {
      // not in bitcoind chain? [forked]
      if (
        (err && err.message === 'Block not found') ||
        (!err && common.confirmations === -1)
      ) {
        debug('local is forked')
        return disconnectBlock(local, tips.local, (err) => {
          if (err) return callback(err)

          resync(rpc, local, callback)
        })
      }
      if (err) return callback(err)

      // local is behind
      debug('bitcoind is ahead')
      connectBlock(rpc, local, common.nextblockhash, common.height + 1, callback)
    })
  })
}
