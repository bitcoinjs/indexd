let debug = require('debug')('zmq')
let zmq = require('zmq')
let zmqSock = zmq.socket('sub')
let { EventEmitter } = require('events')

zmqSock.connect(process.env.ZMQ)

let subbed = {}
let emitter = new EventEmitter()
zmqSock.on('message', (topic, message) => {
  topic = topic.toString('utf8')
  message = message.toString('hex')
  debug(topic, message)

  emitter.emit(topic, message)
})

emitter.on = function zmqSubscribe (topic, callback) {
  if (!subbed[topic]) {
    zmqSock.subscribe(topic)
    subbed[topic] = true

    debug(topic, 'subscribed')
  }

  emitter.addListener(topic, callback)
  debug(topic, 'listening')
}

module.exports = emitter
