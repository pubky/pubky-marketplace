// Preload (`node --import`) that appends every outbound TCP connection this process opens to the file named by
// CONNECTION_LOG, one JSON line `{ host, port }` each. Every client in Node (fetch, http, https, tls) connects
// through `net.Socket.prototype.connect`, so nothing the server reaches is left out. Unix sockets are not logged.
import { appendFileSync } from 'node:fs';
import net from 'node:net';

const LOG = process.env.CONNECTION_LOG;

if (LOG) {
  const connect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...args) {
    // `net.connect` hands the socket its normalized `[options, callback]` array; a direct call passes options or a port.
    const first = Array.isArray(args[0]) ? args[0][0] : args[0];
    const options = typeof first === 'object' && first !== null ? first : { port: first, host: args[1] };
    if (options.path === undefined && options.port !== undefined) {
      appendFileSync(LOG, `${JSON.stringify({ host: options.host ?? 'localhost', port: Number(options.port) })}\n`);
    }
    return connect.apply(this, args);
  };
}
