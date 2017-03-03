let debug = require('debug')('leveldb')
let level = require('level')
let once = require('once')
let ldb = level(process.env.LEVELDB, {
  keyEncoding: 'binary',
  valueEncoding: 'binary'
})
let typeforce = require('typeforce')
let NOTHING = Buffer.alloc(0)

function del (batch, type, key, callback) {
  typeforce(type.keyType, key)
  key = type.key ? type.key.encode(key) : NOTHING
  if (callback) callback = once(callback)

  debug(`del ${key.toString('hex')}`)
  batch.del(key, callback)
}

function get (type, key, callback) {
  typeforce(type.keyType, key)
  key = type.key ? type.key.encode(key) : NOTHING
  callback = once(callback)

  debug(`get ${key.toString('hex')}`)
  ldb.get(key, (err, value) => {
    if (err) return callback(err)
    if (!type.value) return callback()

    callback(null, type.value.decode(value))
  })
}

function put (batch, type, key, value, callback) {
  typeforce(type.keyType, key)
  key = type.key ? type.key.encode(key) : NOTHING

  typeforce(type.valueType, value)
  value = type.value ? type.value.encode(value) : NOTHING
  if (callback) callback = once(callback)

  debug(`put ${key.toString('hex')}|${value.toString('hex')}`)
  batch.put(key, value, callback)
}

function atomic () {
  let batch = ldb.batch()

  return {
    del: (type, key) => {
      del(batch, type, key)
      return batch
    },
    ops: () => batch.length,
    put: (type, key, value) => {
      put(batch, type, key, value)
      return batch
    },
    write: (callback) => batch.write(callback)
  }
}

module.exports = {
  atomic,
  del: del.bind(null, ldb),
  get,
  put: put.bind(null, ldb)
}
