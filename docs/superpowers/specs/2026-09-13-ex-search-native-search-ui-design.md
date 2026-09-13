# ex-search Native Search UI Replacement Design

## Goal

Make ex-search the only visible search-control UI while retaining traQ's
search-result renderer and pagination as an internal implementation boundary.

## User-visible behavior

- The standard traQ search suggestions, five-item history, and standard sort
  selector are hidden while ex-search is active.
- ex-search remains the visible owner of history, suggestions, filters,
  highlighting, and local relevance ordering.
- ex-search exposes the three server-side sort modes that traQ currently
  provides: newest, oldest, and recently updated.
- The existing traQ search input remains the single input and is used as the
  bridge that starts native search. The native result list, empty state,
  pagination, message rendering, and message opening remain visible.
- Stopping or unmounting ex-search removes all hiding markers and restores the
  native search UI.

## Architecture

`dom.js` identifies the native supplemental view immediately after the
extension panel. It recognizes the suggestion view by its semantic header and
the result sort selector by the existing stable CSS-module class prefixes;
exact generated hashes are never used. `app.js` applies idempotent data
markers, removes stale markers when Vue replaces the view, and uses the hidden
native sort selector as a DOM event bridge for ex-search's server-sort select.

The extension does not call the API, access Vue/Pinia state, or modify
traQ_S-UI. CSS hides only native elements carrying an ex-search marker, and
the grid gets a compact three-row layout when the native suggestion view is
hidden.

## Failure behavior

If the native suggestion or sort selector cannot be identified, ex-search keeps
its own controls usable and leaves the unrecognized native element visible.
When a native sort selector appears later, the selected ex-search server sort
is applied after the selector's menu has been rendered. Stopping the app always
restores markers in the document.

## Testing

DOM tests cover semantic discovery, stable-prefix sort discovery, and marker
cleanup. App tests cover hiding both native views, exposing all three server
sort choices, forwarding a selected sort through the hidden native selector,
and restoring native UI on stop. Existing tests and syntax checks remain
required.
