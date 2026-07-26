import { app } from './app';
import { config } from './config';

app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`Combined Storage server listening on http://localhost:${config.port}`);
  if (!config.microsoft) {
    // eslint-disable-next-line no-console
    console.log('OneDrive not configured (set MS_CLIENT_ID / MS_CLIENT_SECRET to enable it).');
  }
  if (config.dav.enabled) {
    // eslint-disable-next-line no-console
    console.log(`WebDAV drive endpoint at /dav (user: ${config.dav.username}).`);
  }
});
