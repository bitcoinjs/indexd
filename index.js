require('dotenv').load()

let debug = require('debug')('index')
let local = require('./local')
let parallel = require('run-parallel')
let rpc = require('./rpc')
let zmq = require('./zmq')

// recursively calls connectBlock(id) until `bitcoind[id].next` is falsy
function connectBlock (id, callback) {
  debug(`Connecting ${id}`)

  rpc('getblockheader', [id], (err, header) => {
    if (err) return callback(err)

    local.connect(id, (err) => {
      if (err) return callback(err)

      debug(`Connected ${id} @${header.height}`)
      if (!header.nextblockhash) return callback()

      // recurse until next is falsy
      connectBlock(header.nextblockhash, callback)
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

function sync (err, callback) {
  if (err) return callback(err)

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

        connectBlock(genesisId, callback)
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
        return disconnectBlock(tips.local, sync)
      }
      if (err) return callback(err)

      // behind
      debug('bitcoind is ahead')
      connectBlock(common.nextblockhash, callback)
    })
  })
}

zmq.on('hashblock', () => sync())
zmq.on('hashtx', (txId) => () => {
  debug(`Seen ${txId} ${Date.now()}`)
  local.see(txId)
})

sync(null, (err) => {
  if (err) throw err
})
