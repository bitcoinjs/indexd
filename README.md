# indexd
[![build status](https://secure.travis-ci.org/dcousens/indexd.png)](http://travis-ci.org/dcousens/indexd)
[![Version](https://img.shields.io/npm/v/indexd.svg)](https://www.npmjs.org/package/indexd)

An external [bitcoind](https://github.com/bitcoin/bitcoin) index management service.


## Indexes
By default,  this module includes a script, spents, transaction block, txout, tx, median time past and fee indexes.
The module uses `getblockheader`, `getblockhash`, `getblock` and `getbestblockhash` RPC methods for blockchain synchronization;  and `getrawmempool` for mempool synchronization.

`-txindex` is not required for this module; but is still useful for individual transaction lookup (aka `txHex`).
See https://github.com/bitcoinjs/indexd/issues/6 if you think an independent transaction index should be added.


## Usage
Assumes [`yajrpc`](https://github.com/dcousens/yajrpc) is used for the provided bitcoind RPC object; and [`leveldown`](https://github.com/level/leveldown) for the database object.
See the [example server](https://github.com/bitcoinjs/private-bitcoin) for an example of an express HTTP API using `indexd`.


### Conventions
When conveying block height, `-1` represents unconfirmed (in the mempool).
`null` represents unknown or missing.

For example, the height of the transaction `ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff` in the Bitcoin blockchain is `null` (it doesn't exist!).


## LICENSE [ISC](LICENSE)
