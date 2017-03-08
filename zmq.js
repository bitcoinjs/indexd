let debug = require('debug')('zmq')
let zmq = require('zmq')
let { EventEmitter } = require('events')

module.exports = function listen (address) {
  let emitter = new EventEmitter()
  let subbed = {}
  let zmqSock = zmq.socket('sub')

  zmqSock.connect(address)
  zmqSock.on('message', (topic, message) => {
    topic = topic.toString('utf8')
    message = message.toString('hex')
    debug(topic, message)

    emitter.emit(topic, message)
  })

  return {
    on: function zmqSubscribe (topic, callback) {
      if (!subbed[topic]) {
        zmqSock.subscribe(topic)
        subbed[topic] = true

        debug(topic, 'subscribed')
      }

      emitter.addListener(topic, callback)
      debug(topic, 'listening')
    }
  }
}
