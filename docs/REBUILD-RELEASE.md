# Document features rebuild

Production remains on the restored original website and Apps Script version 36 while this branch is reviewed. This branch restores the requested WI/quality libraries, centralized Admin document management, model/station filters, clickable document names, full-window preview and Print, and loading improvements.

## Mandatory release checks

1. Confirm the intended deploying Google account can open the original transaction spreadsheet, ENC-MASTER and configured Drive folder. Project editor access alone does not establish access to those resources.
2. Back up project source, deployment configuration and Script Properties. Do not overwrite MASTER_SPREADSHEET_ID or reseed existing data to work around an access error.
3. Install candidate source in the editor without updating the production deployment. Run `checkDeploymentReadiness` using the intended deploying account. It reads sheet headers and folder metadata and makes no database writes. Every check must pass. This verifies read access; verify write access separately before release.
4. Test authenticated login, master refresh, user listing and the actual WI PDF in a test deployment. Check that the modal's Print opens print preview for the actual document. Mock tests alone do not establish production PDF loading.
5. Confirm non-Admin document mutations are rejected at the API. Check Admin document/station updates against a designated test document, not an existing production revision.
6. Only update production after these checks pass; confirm the executing account and retain the existing URL. If Google requires authorization, complete it and verify authenticated API requests before calling deployment complete.

The existing deployment must not be updated from the currently connected account while its ENC-MASTER access check is failing. Reverting source does not restore another account's Google access.

## Validation

`tests/document-control.cjs` exercises mocked APIs in Edge: libraries, filters, station/model assignments, Admin guards, fullscreen modal/Print invocation, cache fallback, users reload, versioned master caching and alternate GET/POST transport. Live data access and real PDF printing remain release requirements.
