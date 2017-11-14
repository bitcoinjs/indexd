let adapter = require('./service').adapter
let debug = require('debug')('example:ws')
let rpc = require('./rpc')
let vs = require('varstruct')
let { EventEmitter } = require('events')

// vs types
let vsHex256bit = vs.String(32, 'Hex')
let vsHashes = vs.VarArray(vs.UInt16LE, vsHex256bit)
let vsHeight = vs.UInt32LE

let vsBlock = vs([
  ['type', vs.Value(vs.UInt8, 0x00)],
  ['id', vsHex256bit],
  ['height', vsHeight],
  ['time', vs.UInt32LE]
])
let vsTx = vs([
  ['type', vs.Value(vs.UInt8, 0x01)],
  ['data', vs.VarBuffer(vs.UInt16LE)]
])
let vsStatus = vs([
  ['type', vs.Value(vs.UInt8, 0x02)],
  ['blockId', vsHex256bit],
  ['txId', vsHex256bit]
])

let shared = new EventEmitter()
shared.setMaxListeners(Infinity)

adapter.emitter.on('block', (blockId) => {
  let listeners = shared.listenerCount('block')
  if (!listeners) return

  rpc('getblockheader', [blockId, true], (err, header) => {
    if (err || !header) return debug(err || `${blockId} not found`)

    shared.emit('block', vsBlock({
      id: header.hash,
      height: header.height,
      time: header.medianTime
    }))
  })
})

adapter.emitter.on('script', (scId, _, txBuffer) => {
  let listeners = shared.listenerCount(scId)
  if (!listeners) return

  shared.emit(scId, vsTx(txBuffer))
})

adapter.emitter.on('transaction', (txId, _, blockId) => {
  let listeners = shared.listenerCount(txId)
  if (!listeners) return

  shared.emit(txId, vsStatus(blockId, txId))
})

module.exports = function handleSocket (socket) {
  let load = 0
  let height = 0
  let watching = {}

  function send (buffer) {
    socket.send(buffer)
  }

  function sendBlocks (blockIds) {
    blockIds.forEach((blockId) => {
      rpc('getblockheader', [blockId, true], (err, header) => {
        if (err || !header) return debug(err || `${blockId} not found`)

        debug(`sending block ${blockId}`)
        send(vsBlock({
          id: header.hash,
          height: header.height,
          time: header.medianTime
        }))
      })
    })
  }

  function sendStatus (blockId, txId) {
    debug(`sending status ${blockId}:${txId}`)
    send(vsStatus({ blockId, txId }))

    load -= 1
    delete watching[txId]
  }

  function sendTxs (txIds) {
    txIds.forEach((txId) => {
      rpc('getrawtransaction', [txId], (err, txHex) => {
        if (err || !txHex) return debug(err || `${txId} not found`)

        debug(`sending tx ${txId}`)
        let txBuffer = Buffer.from(txHex, 'hex')
        send(vsTx(txBuffer))
      })
    })
  }

  function open () {
    shared.on('block', send)

    adapter.tip((err, blockId) => {
      if (err) return
      sendBlocks([blockId])
    })
  }

  function reset () {
    shared.removeListener('block', send)

    for (let hash in watching) {
      shared.removeListener(hash, send)
      shared.removeListener(hash, send)
    }
  }

  function kill (err) {
    if (err) debug(err)
    reset()
    socket.terminate()
  }

  function receive (buffer) {
    if (!Buffer.isBuffer(buffer)) return kill(new TypeError('Expected buffer'))
    if (buffer.length < 2 || buffer.length > 32000) return kill(new Error('Bad data'))

    let type = buffer[0]
    let data = buffer.slice(1)

    if (type === 0x00) {
      try {
        height = vsHeight.decode(data)
      } catch (e) { return kill(e) }
      return
    }

    let hashes
    try {
      hashes = vsHashes.decode(data)
    } catch (e) { return kill(e) }

    // limit 192KiB (3000 * 32 bytes * 2 (hex)) hashes per socket
    if (load > 3000) return kill(new Error('Too high load'))

    // idempotent, blocks / transactions
    if (type === 0x01) return sendBlocks(hashes)
    if (type === 0x02) return sendTxs(hashes)

    // transactions (status)
    if (type === 0x03) {
      load += hashes.length
      hashes.forEach((txId) => {
        watching[txId] = true
        shared.on(txId, send)

        adapter.blockIdByTransactionId(txId, (err, blockId) => {
          if (err) return
          sendStatus(blockId, txId)
        })
      })
      return
    }

    // scripts
    if (type === 0x04) {
      load += hashes.length
      hashes.forEach((scId) => {
        watching[scId] = true
        shared.on(scId, send)

        adapter.transactionIdListFromScriptId(scId, height, (err, txIds) => {
          if (err) return

          sendTxs(txIds)
        })
      })
    }
  }

  socket.on('message', receive)
  socket.on('close', reset)
  open()
}
