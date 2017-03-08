require('dotenv').load()

let debug = require('debug')('index')
let local = require('./local')
let sync = require('./sync')
let qup = require('qup')
let zmq = require('./zmq')
let rpc = require('yajrpc/qup')({
  url: process.env.RPC,
  user: process.env.RPCUSER,
  pass: process.env.RPCPASSWORD,
  batch: process.env.RPCBATCHSIZE,
  concurrent: process.env.RPCCONCURRENT
})

function debugIfErr (err) {
  if (err) debug(err)
}

local(process.env.LEVELDB, rpc, (err, db) => {
  if (err) return debugIfErr(err)

  let syncQueue = qup((next) => sync(rpc, db, next), 1)

  let _zmq = zmq(process.env.ZMQ)
  _zmq.on('hashblock', () => {
    syncQueue.push(null, debugIfErr)
  })

//   _zmq.on('hashtx', (txId) => {
//     debug(`Seen ${txId} ${Date.now()}`)
//     local.see(txId)
//   })

  syncQueue.push(null, debugIfErr)
})
