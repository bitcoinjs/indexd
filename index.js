require('dotenv').load()

let debug = require('debug')('index')
let local = require('./local')
let parallel = require('run-parallel')
let rpc = require('./rpc')
let zmq = require('./zmq')

// recursively calls connectBlock(id) until `bitcoind[id].next` is falsy
function connectBlock (id, height, callback) {
  debug(`Connecting ${id} @${height}`)

  rpc('getblockheader', [id], (err, header) => {
    if (err) return callback(err)
    if (header.height !== height) return callback(new Error('Height mismatch'))

    local.connect(id, height, (err) => {
      if (err) return callback(err)

      debug(`Connected ${id} @${height}`)
      if (!header.nextblockhash) return callback()

      // recurse until next is falsy
      connectBlock(header.nextblockhash, height + 1, callback)
    })
  })
}

function disconnectBlock (id, callback) {
  debug(`Disconnecting ${id}`)

  local.disconnect(id, (err) => {
    if (err) return callback(err)

    debug(`Disconnected ${id}`)
    callback()
  })
}

function sync (callback) {
  debug('Checking bitcoind/local chains')

  parallel({
    bitcoind: (f) => rpc('getbestblockhash', [], f),
    local: (f) => local.tip(f)
  }, (err, tips) => {
    if (err) return callback(err)

    // Step 0, genesis?
    if (!tips.local) {
      debug('genesis')
      return rpc('getblockhash', [0], (err, genesisId) => {
        if (err) return callback(err)

        connectBlock(genesisId, 0, callback)
      })
    }

    // Step 1, equal?
    debug('tips', tips)
    if (tips.bitcoind === tips.local) return callback()

    // else, Step 2, is local behind? [bitcoind has local tip]
    rpc('getblockheader', [tips.local], (err, common) => {
      // not in bitcoind chain? [forked]
      if (
        (err && err.message === 'Block not found') ||
        (!err && common.confirmations === -1)
      ) {
        debug('local is forked')
        return disconnectBlock(tips.local, (err) => {
          if (err) return callback(err)

          sync(callback)
        })
      }
      if (err) return callback(err)

      // behind
      debug('bitcoind is ahead')
      connectBlock(common.nextblockhash, common.height + 1, callback)
    })
  })
}

function debugIfErr (err) {
  if (err) debug(err)
}

zmq.on('hashblock', () => sync(debugIfErr))
zmq.on('hashtx', (txId) => () => {
  debug(`Seen ${txId} ${Date.now()}`)
  local.see(txId)
})

sync(debugIfErr)
