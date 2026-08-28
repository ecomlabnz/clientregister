/**
 * The application version, shown in the footer and on the help page.
 *
 * Read from package.json so there is one place to change it, and so a build can
 * never disagree with the release it came from.
 */

import pkg from '../package.json';

export const APP_VERSION: string = pkg.version;
