let debug = require('debug')('rpc')
let qup = require('qup')
let Yajrpc = require('yajrpc')

let client = new Yajrpc({
  url: process.env.RPC,
  user: process.env.RPCUSER,
  pass: process.env.RPCPASSWORD
})

// group RPC calls into batches of RPCBATCHSIZE, with RPCCONCURRENT batches concurrently
let q = qup((batch, callback) => {
  let methods = batch.slice(0, 10).map(x => x.method).join(' ')
  debug(`${batch.length} / ${process.env.RPCBATCHSIZE}`, methods)

  client.batch(batch, callback)
}, process.env.RPCCONCURRENT, process.env.RPCBATCHSIZE)

module.exports = function rpc (method, params, callback) {
  q.push({ method, params, callback })
}
