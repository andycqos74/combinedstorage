import type { StorageProvider } from './provider';
import { LocalProvider, type LocalConfig } from './local';
import { OneDriveProvider } from './onedrive';
import { GoogleDriveProvider } from './googledrive';
import { type BackendRow, backendConfig } from '../models/backends';

/**
 * Build a live StorageProvider from a persisted backend row. This is the one place that
 * knows the full set of backend types; everything else works through StorageProvider.
 */
export function providerFor(row: BackendRow): StorageProvider {
  switch (row.type) {
    case 'local':
      return new LocalProvider(row.id, backendConfig<LocalConfig>(row));
    case 'onedrive':
      return new OneDriveProvider(row);
    case 'googledrive':
      return new GoogleDriveProvider(row);
    default:
      throw new Error(`Unknown backend type: ${row.type}`);
  }
}
