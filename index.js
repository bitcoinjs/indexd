require('dotenv').load()

let debug = require('debug')('index')
let leveldown = require('leveldown')
let localIndex = require('./local')
let qup = require('qup')
let resync = require('./resync')
let rpc = require('yajrpc/qup')({
  url: process.env.RPC,
  user: process.env.RPCUSER,
  pass: process.env.RPCPASSWORD,
  batch: process.env.RPCBATCHSIZE,
  concurrent: process.env.RPCCONCURRENT
})
let zmq = require('./zmq')

function debugIfErr (err) {
  if (err) debug(err)
}

let db = leveldown(process.env.LEVELDB)
db.open({
  writeBufferSize: 1 * 1024 * 1024 * 1024
}, (err) => {
  if (err) return debugIfErr(err)
  debug('Opened database')

  let local = localIndex(rpc, db)
  let localSyncQueue = qup((_, next) => resync(rpc, local, next), 1)

  zmq.on('hashblock', () => {
    localSyncQueue.push(null, debugIfErr)
  })

  zmq.on('hashtx', (txId) => {
    local.see(txId)
  })

  localSyncQueue.push(null, debugIfErr)
})
