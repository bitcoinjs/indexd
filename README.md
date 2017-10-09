# indexd
[![build status](https://secure.travis-ci.org/dcousens/indexd.png)](http://travis-ci.org/dcousens/indexd)
[![Version](https://img.shields.io/npm/v/indexd.svg)](https://www.npmjs.org/package/indexd)

An external [bitcoind](https://github.com/bitcoin/bitcoin) index management service.

## Indexes
By default,  this module maintains script, spents, transaction block, txout and block indexes.
The module uses `getblockheader`, `getblock` and `getbestblockhash` RPC methods, solely.

`-txindex` is not required for this module; but is still useful for individual transaction lookup (aka `txHex`).
See https://github.com/bitcoinjs/indexd/issues/6 if you think an independent transaction index should be added.


## Example
Uses [`yajrpc`](https://github.com/dcousens/yajrpc) for the bitcoind RPC;
[`leveldown`](https://github.com/level/leveldown) for the database;
and [`zmq`](https://www.npmjs.com/package/zmq) for bitcoind notifications.

See [`test/index.js`](test/index.js) for a functioning example.


## License [ISC](LICENSE)
