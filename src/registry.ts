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
import { feesModule } from './modules/fees';
import { inquiriesModule } from './modules/inquiries';
import { quotesModule } from './modules/quotes';
import { tasksModule } from './modules/tasks';
import { documentsModule } from './modules/documents';
import { inboxModule } from './modules/inbox';
import { adminModule } from './modules/admin';
import { knowledgeModule } from './modules/knowledge';
import { assistantModule } from './modules/assistant';
import { workflowsModule } from './modules/workflows';
import { helpModule } from './modules/help';

export const registeredModules: AppModule[] = [
  authModule,
  // Ahead of the dashboard: both answer for '/', and the website only takes it
  // when nobody is signed in.
  landingModule,
  dashboardModule,
  alertsModule,
  inboxModule,
  inquiriesModule,
  clientsModule,
  casesModule,
  feesModule,
  quotesModule,
  tasksModule,
  documentsModule,
  knowledgeModule,
  assistantModule,
  workflowsModule,
  adminModule,
  helpModule,
];
