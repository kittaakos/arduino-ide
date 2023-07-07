import path from 'node:path';
import express from '@theia/core/shared/express';
import { injectable } from '@theia/core/shared/inversify';
import { BackendApplicationContribution } from '@theia/core/lib/node/backend-application';

@injectable()
export class PlotterBackendContribution
  implements BackendApplicationContribution
{
  configure(app: express.Application): void {
    const plotterRootPath = path.resolve(
      __dirname,
      '../../../../electron-app/lib/backend/plotter-webapp'
    );
    app.use(express.static(plotterRootPath));
    app.get('/plotter', (req, res) => {
      console.log(
        `Serving serial plotter on http://${req.headers.host}${req.url}`
      );
      res.sendFile(path.join(plotterRootPath, 'index.html'));
    });
  }
}
