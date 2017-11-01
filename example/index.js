require('dotenv').load()

let express = require('express')
let service = require('./service')
let api = require('./express')
var app = express()

// initialize
service((err) => {
  if (err) return console.error('error initializing', err)

  app.use(api())
  app.listen(3000)
})
