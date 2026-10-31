import { createCloudPluginLoader } from './loader.js';

export { type CloudBillingStore } from './loader.js';

const loader = createCloudPluginLoader(import.meta.url);
export const isCloudPluginInstalled = loader.isInstalled;
export const loadCloudPlugin = loader.load;
