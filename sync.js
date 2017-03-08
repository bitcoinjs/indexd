let debug = require('debug')('index')
let parallel = require('run-parallel')
let rpc = require('./rpc')

// recursively calls connectBlock(id) until `bitcoind[id].next` is falsy
function connectBlock (db, id, height, callback) {
  debug(`Connecting ${id} @ ${height}`)

  rpc('getblockheader', [id], (err, header) => {
    if (err) return callback(err)
    if (header.height !== height) return callback(new Error('Height mismatch'))

    db.connect(id, height, (err) => {
      if (err) return callback(err)

      debug(`Connected ${id} @ ${height}`)
      if (!header.nextblockhash) return callback()

      // recurse until next is falsy
      connectBlock(db, header.nextblockhash, height + 1, callback)
    })
  })
}

function disconnectBlock (db, id, callback) {
  debug(`Disconnecting ${id}`)

  db.disconnect(id, (err) => {
    if (err) return callback(err)

    debug(`Disconnected ${id}`)
    callback()
  })
}

function sync (db, callback) {
  debug('fetching bitcoind/db tips')

  parallel({
    bitcoind: (f) => rpc('getbestblockhash', [], f),
    db: (f) => db.tip(f)
  }, (err, tips) => {
    if (err) return callback(err)

    // Step 0, genesis?
    if (!tips.db) {
      debug('genesis')
      return rpc('getblockhash', [0], (err, genesisId) => {
        if (err) return callback(err)

        connectBlock(db, genesisId, 0, callback)
      })
    }

    // Step 1, equal?
    debug('...', tips)
    if (tips.bitcoind === tips.db) return callback()

    // else, Step 2, is db behind? [bitcoind has db tip]
    rpc('getblockheader', [tips.db], (err, common) => {
      // not in bitcoind chain? [forked]
      if (
        (err && err.message === 'Block not found') ||
        (!err && common.confirmations === -1)
      ) {
        debug('db is forked')
        return disconnectBlock(db, tips.db, (err) => {
          if (err) return callback(err)

          sync(db, callback)
        })
      }
      if (err) return callback(err)

      // behind
      debug('bitcoind is ahead')
      connectBlock(db, common.nextblockhash, common.height + 1, callback)
    })
  })
}

module.exports = sync
