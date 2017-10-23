module.exports = require('yajrpc/qup')({
  url: process.env.RPC,
  user: process.env.RPCUSER,
  pass: process.env.RPCPASSWORD,
  batch: process.env.RPCBATCHSIZE,
  concurrent: process.env.RPCCONCURRENT
})
