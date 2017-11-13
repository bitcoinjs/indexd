let bitcoin = require('bitcoinjs-lib')
let bodyParser = require('body-parser')
let express = require('express')
let adapter = require('./service').adapter
let parallel = require('run-parallel')
let rpc = require('./rpc')

function Hex256bit (value) {
  return typeof value === 'string' && /^[0-9a-fA-F]{64}$/.test(value)
}

module.exports = function () {
  let router = new express.Router()

  function respond (req, res, err, result, errMatch) {
    if (err) console.error(req.path, err)
    if (err) {
      res.status(typeof err === 'number' ? err : 400)
      if (errMatch && errMatch.test(err.message)) res.json(err.message)
      return res.end()
    }

    res.status(200)
    if (result !== undefined) {
      if (typeof result === 'string') res.send(result)
      else if (Buffer.isBuffer(result)) res.send(result)
      else res.json(result)
    }
    res.end()
  }

  router.get('/a/:address/txs', (req, res) => {
    let scId
    try {
      let script = bitcoin.address.toOutputScript(req.params.address)
      scId = bitcoin.crypto.sha256(script).toString('hex')
    } catch (e) { return respond(req, res, 400) }

    let height = parseInt(req.query.height)
    if (!Number.isFinite(height)) height = 0

    adapter.transactionIdsByScriptId(scId, height, (err, txIdSet) => {
      if (err) return respond(req, res, err)

      let tasks = {}
      for (let txId in txIdSet) {
        tasks[txId] = (next) => rpc('getrawtransaction', [txId], next)
      }

      parallel(tasks, (err, result) => respond(req, res, err, result))
    })
  })

  router.get('/a/:address/txids', (req, res) => {
    let scId
    try {
      let script = bitcoin.address.toOutputScript(req.params.address)
      scId = bitcoin.crypto.sha256(script).toString('hex')
    } catch (e) { return respond(req, res, 400) }

    let height = parseInt(req.query.height)
    if (!Number.isFinite(height)) height = 0

    adapter.transactionIdsByScriptId(scId, height, (err, txIdSet) => respond(req, res, err, Object.keys(txIdSet)))
  })

  router.get('/a/:address/instances', (req, res) => {
    let scId
    try {
      let script = bitcoin.address.toOutputScript(req.params.address)
      scId = bitcoin.crypto.sha256(script).toString('hex')
    } catch (e) { return respond(req, res, 400) }

    adapter.seenScriptId(scId, (err, result) => respond(req, res, err, result))
  })

  router.get('/a/:address/unspents', (req, res) => {
    let scId
    try {
      let script = bitcoin.address.toOutputScript(req.params.address)
      scId = bitcoin.crypto.sha256(script).toString('hex')
    } catch (e) { return respond(req, res, 400) }

    adapter.utxosByScriptId(scId, (err, result) => respond(req, res, err, result))
  })

  router.get('/t/:id', (req, res) => {
    if (!Hex256bit(req.params.id)) return res.status(400).end()

    rpc('getrawtransaction', req.params.id, (err, result) => respond(req, res, err, result))
  })

  router.get('/t/:id/block', (req, res) => {
    if (!Hex256bit(req.params.id)) return res.status(400).end()

    adapter.blockIdByTransactionId(req.params.id, (err, result) => respond(req, res, err, result))
  })

  router.post('/t/push', bodyParser.text(), (req, res) => {
    rpc('sendrawtransaction', [req.body], (err) => respond(req, res, err, undefined, /./))
  })

  router.get('/b/:id/header', (req, res) => {
    if (!Hex256bit(req.params.id)) return res.status(400).end()

    rpc('getblockheader', [req.params.id, true], (err, header) => respond(req, res, err, header, /not found/))
  })

  router.get('/b/:id/height', (req, res) => {
    if (!Hex256bit(req.params.id)) return res.status(400).end()

    rpc('getblockheader', [req.params.id, false], (err, json) => respond(req, res, err, json && json.height, /not found/))
  })

  router.get('/b/height', (req, res) => {
    rpc('getblockcount', [], (err, result) => respond(req, res, err, result))
  })

  router.get('/b/fees', (req, res) => {
    let blocks = parseInt(req.query.blocks)
    if (!Number.isFinite(blocks)) blocks = 12
    blocks = Math.min(blocks, 64)

    adapter.blockchain.fees(blocks, (err, results) => {
      if (results) {
        results.forEach((x) => {
          x.kB = Math.floor(x.size / 1024)
        })
      }

      respond(req, res, err, !err && results)
    })
  })

  return router
}
