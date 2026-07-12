export { default } from './diagnostics-telescope.extension.js';
export {
  type DiagnosticsTelescopeOptions,
  nestjsDiagnosticsTelescope,
} from './diagnostics-telescope.extension.js';
export {
  buildDiagnosticEntry,
  buildDiagnosticSpanEntry,
  DIAGNOSTIC_ENTRY_TYPE,
  type DiagnosticEntryContent,
  type DiagnosticEntryContentBase,
  type DiagnosticSpanEntryContent,
  DiagnosticWatcher,
  type DiagnosticWatcherOptions,
  isDiagnosticEvent,
  isSpanEvent,
} from './diagnostic.watcher.js';
