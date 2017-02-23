let debug = require('debug')('leveldb')
let level = require('level')
let once = require('once')
let ldb = level(process.env.LEVELDB)

function del (batch, type, key, callback) {
  key = type.key.encode(key)
  if (callback) callback = once(callback)

  if (type.prefix && type.prefix.length) {
    key = Buffer.concat([type.prefix, key])
  }

  debug(`del ${key.toString('hex')}`)
  batch.del(key, callback)
}

function get (type, key, callback) {
  key = type.key.encode(key)
  callback = once(callback)

  if (type.prefix && type.prefix.length) {
    key = Buffer.concat([type.prefix, key])
  }

  debug(`get ${key.toString('hex')}`)
  ldb.get(key, (err, value) => {
    if (err) return callback(err)

    callback(null, type.value.decode(value))
  })
}

function put (batch, type, key, value, callback) {
  key = type.key.encode(key)
  value = type.value.encode(value)
  if (callback) callback = once(callback)

  if (type.prefix && type.prefix.length) {
    key = Buffer.concat([type.prefix, key])
  }

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
