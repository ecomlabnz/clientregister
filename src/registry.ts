/**
 * The module registry.
 *
 * This list *is* the application's feature set. Adding a feature means writing
 * a module folder and adding one line here; removing one means deleting a line.
 * Order affects only the admin listing — navigation order is set per nav item.
 */

import type { AppModule } from './core/module';
import { authModule } from './modules/auth';
import { landingModule } from './modules/landing';
import { dashboardModule } from './modules/dashboard';
import { alertsModule } from './modules/alerts';
import { clientsModule } from './modules/clients';
import { casesModule } from './modules/cases';
import { inquiriesModule } from './modules/inquiries';
import { quotesModule } from './modules/quotes';
import { mailModule } from './modules/mail';
import { clientQuoteModule } from './modules/clientquote';
import { publicDocModule } from './modules/publicdoc';
import { shortcutModule } from './modules/shortcut';
import { invoicesModule } from './modules/invoices';
import { tasksModule } from './modules/tasks';
import { calendarModule } from './modules/calendar';
import { documentsModule } from './modules/documents';
import { notesModule } from './modules/notes';
import { flagsModule } from './modules/flags';
import { inboxModule } from './modules/inbox';
import { adminModule } from './modules/admin';
import { knowledgeModule } from './modules/knowledge';
import { assistantModule } from './modules/assistant';
import { workflowsModule } from './modules/workflows';
import { helpModule } from './modules/help';
import { searchModule } from './modules/search';

export const registeredModules: AppModule[] = [
  authModule,
  searchModule,
  // Ahead of the dashboard: both answer for '/', and the website only takes it
  // when nobody is signed in.
  landingModule,
  // Ahead of the dashboard for a harder reason. The dashboard mounts at '/'
  // and puts `requireAuth` on '*', which in Hono is every path in the
  // application — so anything registered after it is behind a sign-in whatever
  // its own routes say. This is the one page in the register that a client
  // opens with no account at all, and it was silently redirecting them to a
  // login screen until this line moved. Found by opening the link as a client
  // would, in a browser with no session, which is the only way it shows.
  clientQuoteModule,
  publicDocModule,
  // Above the dashboard for the same reason as the two lines before it, and
  // for one more. A shortcut on the practice's Mac or phone carries a token,
  // not a session — there is no cookie for `requireAuth` to find, so behind
  // the dashboard's guard on '*' every upload would be answered with a
  // redirect to a login page that a Shortcuts action cannot read. It is also
  // in `WEBHOOK_PATHS` in `src/app.ts`: a shortcut sends no `Origin` header,
  // so the cross-site check would otherwise refuse it. A test holds both.
  shortcutModule,
  dashboardModule,
  alertsModule,
  inboxModule,
  inquiriesModule,
  clientsModule,
  casesModule,
  quotesModule,
  // Reading back a letter that has already gone out. Mounted after the
  // records it is reached from, because it is never the first page of
  // anything: a link on a file note or a record's list of sent mail is the
  // only way in.
  mailModule,
  invoicesModule,
  tasksModule,
  calendarModule,
  documentsModule,
  notesModule,
  flagsModule,
  knowledgeModule,
  assistantModule,
  workflowsModule,
  adminModule,
  helpModule,
];
