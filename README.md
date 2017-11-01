# indexd
[![build status](https://secure.travis-ci.org/dcousens/indexd.png)](http://travis-ci.org/dcousens/indexd)
[![Version](https://img.shields.io/npm/v/indexd.svg)](https://www.npmjs.org/package/indexd)

An external [bitcoind](https://github.com/bitcoin/bitcoin) index management service.

## Indexes
By default,  this module maintains script, spents, transaction block, txout and block indexes.
The module uses `getblockheader`, `getblockhash`, `getblock` and `getbestblockhash` RPC methods for blockchain synchronization;  and `getrawmempool` for mempool synchronization.

`-txindex` is not required for this module; but is still useful for individual transaction lookup (aka `txHex`).
See https://github.com/bitcoinjs/indexd/issues/6 if you think an independent transaction index should be added.


## Example
Assumes [`yajrpc`](https://github.com/dcousens/yajrpc) is used for the bitcoind RPC;
and [`leveldown`](https://github.com/level/leveldown) for the database.

See [`example/`](https://github.com/bitcoinjs/indexd/tree/master/example) for a functioning express HTTP API example.

* Requires a running `bitcoind` node with ZMQ (`-zmqpubhashtx=tcp://127.0.0.1:30001 -zmqpubhashblock=tcp://127.0.0.1:30001`) and `-txindex`.
* Defaults to `--testnet` ports/configuration, see `example/.env` for configuration.


## License [ISC](LICENSE)
