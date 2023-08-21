import http from 'node:http';
import url from 'node:url';
import { body } from './body';
import { authServerPort } from '../../common/protocol/authentication-service';

export const authCallbackPath = 'callback';

export function createServer(
  authCallback: (req: http.IncomingMessage, res: http.ServerResponse) => void
) {
  const server = http.createServer(function (req, res) {
    const reqUrl = url.parse(req.url!, /* parseQueryString */ true);
    switch (reqUrl.pathname) {
      case `/${authCallbackPath}`:
        authCallback(req, res);
        res.writeHead(200, {
          'Content-Length': body.length,
          'Content-Type': 'text/html; charset=utf-8',
        });
        res.end(body);
        break;
      default:
        res.writeHead(404);
        res.end();
        break;
    }
  });
  return server;
}

export async function startServer(server: http.Server): Promise<string> {
  let portTimer: NodeJS.Timeout;

  function cancelPortTimer() {
    clearTimeout(portTimer);
  }

  const port = new Promise<string>((resolve, reject) => {
    portTimer = setTimeout(() => {
      reject(new Error('Timeout waiting for port'));
    }, 5000);

    server.on('listening', () => {
      const address = server.address();
      if (typeof address === 'undefined' || address === null) {
        reject(new Error('address is null or undefined'));
      } else if (typeof address === 'string') {
        resolve(address);
      } else {
        resolve(address.port.toString());
      }
    });

    server.on('error', (_) => {
      reject(new Error('Error listening to server'));
    });

    server.on('close', () => {
      reject(new Error('Closed'));
    });

    server.listen(authServerPort);
  });

  port.then(cancelPortTimer, cancelPortTimer);
  return port;
}
