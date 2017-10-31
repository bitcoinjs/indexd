let debug
try {
  debug = require('debug')
} catch (e) {}

function noop () {}

module.exports = debug || noop
