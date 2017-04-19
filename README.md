# indexd

[![build status](https://secure.travis-ci.org/dcousens/indexd.png)](http://travis-ci.org/dcousens/indexd)
[![Version](https://img.shields.io/npm/v/indexd.svg)](https://www.npmjs.org/package/indexd)

An external [bitcoind](https://github.com/bitcoin/bitcoin) index management service.

## Indexes
By default,  this module maintains script, spents, transaction, txout and block indexes.


## Example
Uses [`yajrpc`](https://github.com/dcousens/yajrpc) for the bitcoind RPC;
[`leveldown`](https://github.com/level/leveldown) for the database;
and [`zmq`](https://www.npmjs.com/package/zmq) for bitcoind notifications.

See [`test/index.js`](test/index.js) for a functioning example.


## License [ISC](LICENSE)
