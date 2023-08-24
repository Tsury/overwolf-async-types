export * from './promisify';
export * from './types/overwolf.d.ts';
export * from './types/owads.d.ts';
import { OwAd as OwAdClass } from './types/owads.d.ts';

// This fixes the OwAd type not being globally available
// TODO: Remove this once Overwolf addresses it in their own repo.
declare global {
  var OwAd: typeof OwAdClass | undefined;
}
