module.exports = require('yajrpc/qup')({
  url: process.env.RPC,
  auth: require('fs').readFileSync(process.env.RPCCOOKIE),
  batch: process.env.RPCBATCHSIZE || 500,
  concurrent: process.env.RPCCONCURRENT || 16
})
