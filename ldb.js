let debug = require('debug')('leveldb')
let level = require('level')
let once = require('once')
let ldb = level(process.env.LEVELDB, {
  keyEncoding: 'binary',
  valueEncoding: 'binary'
})
let typeforce = require('typeforce')

function del (batch, type, key, callback) {
  typeforce(type.keyType, key)
  key = type.key.encode(key)
  if (callback) callback = once(callback)

  debug(`del ${key.toString('hex')}`)
  batch.del(key, callback)
}

function get (type, key, callback) {
  typeforce(type.keyType, key)
  key = type.key.encode(key)
  callback = once(callback)

  debug(`get ${key.toString('hex')}`)
  ldb.get(key, (err, value) => {
    if (err) return callback(err)
    if (!type.value) return callback()

    callback(null, type.value.decode(value))
  })
}

let NOTHING = Buffer.alloc(0)

function put (batch, type, key, value, callback) {
  typeforce(type.keyType, key)
  key = type.key.encode(key)

  typeforce(type.valueType, value)
  if (type.value) value = type.value.encode(value)
  else value = NOTHING
  if (callback) callback = once(callback)

  debug(`put ${key.toString('hex')}|${value.toString('hex')}`)
  batch.put(key, value, callback)
}

function iterator (type, options, forEach, callback) {
  callback = once(callback)

  // TODO: don't mutate
  if (options.gt) options.gt = type.key.encode(options.gt)
  if (options.lt) options.lt = type.key.encode(options.lt)
  if (options.gte) options.gte = type.key.encode(options.gte)
  if (options.lte) options.lte = type.key.encode(options.lte)

  ldb.createReadStream(options)
  .on('data', ({ key, value }) => {
    if (!options.raw) {
      key = type.key.decode(key)
      value = type.value.decode(value)
    }

    forEach(key, value)
  })
  .on('end', callback)
  .on('error', callback)
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
  iterator,
  del: del.bind(null, ldb),
  get,
  put: put.bind(null, ldb)
}
