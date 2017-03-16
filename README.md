# indexd
An external [bitcoind](https://github.com/bitcoin/bitcoin) index management service.


## Example
Uses [`yajrpc`](https://github.com/dcousens/yajrpc) for the bitcoind RPC;
[`leveldown`](https://github.com/level/leveldown) for the database;
and [`zmq`](https://www.npmjs.com/package/zmq) for bitcoind notifications.

See [`test/index.js`](test/index.js) for a functioning example.


## License [ISC](LICENSE)
