// Railway Infrastructure as Code for the web service. Replaces railway.json
// (Config as Code stops working on 2026-12-01). Always run `railway config plan`
// and read it before `railway config apply`: a resource or variable this file
// does not declare is planned for deletion.
//
// Scope: this file manages only the grants-dot-watch web service (the partial
// below). Postgres, its volumes and research-backfill-runner are not declared
// here and stay managed in the Railway dashboard.
//
// Every variable is preserve(): Railway keeps the value already set. Add a new
// variable here as preserve() when it is created in the dashboard, or the next
// apply will plan to delete it.
//
// The build uses the service's builder, Railpack, which reads the Node version
// from .node-version (22, the version Nixpacks used) and runs `npm ci` and
// `npm run build`. Railway's default restart policy (on failure, 10 retries)
// matches the old railway.json.
import { defineRailway, github, preserve, project, service } from "railway/iac";

export const partial = "grants-dot-watch";

export default defineRailway(() => {
  const grantsDotWatch = service("grants-dot-watch", {
    source: github("SovereignSignal/grants-dot-watch", { checkSuites: false }),
    start: "npm run start",
    healthcheck: "/",
    replicas: { "us-west2": 1 },
    domains: ["grants.watch"],
    env: {
      ADMIN_TOKEN: preserve(),
      AWARD_SOURCES_AUTO_APPLY: preserve(),
      AWARD_SOURCES_ENABLED: preserve(),
      DATABASE_URL: preserve(),
      DESK_OWNERS: preserve(),
      DESK_UPKEEP_ENABLED: preserve(),
      DISCUSS_WATCH_GRANTS_URL: preserve(),
      GRANTS_WATCH_API_V2: preserve(),
      GRANTS_WATCH_CURATOR_KEYS: preserve(),
      GRANTS_WATCH_FUNDING_DESK: preserve(),
      GRANTS_WATCH_NO_GIT: preserve(),
      GRANTS_WATCH_PUBLIC_URL: preserve(),
      GRANTS_WATCH_READER_KEYS: preserve(),
      INGEST_ENABLED: preserve(),
      NEXT_PUBLIC_PRIVY_APP_ID: preserve(),
      NEXT_PUBLIC_PRIVY_CLIENT_ID: preserve(),
      PRIVY_APP_SECRET: preserve(),
      REVIEW_RECHECK_ENABLED: preserve(),
      WIRE_DATABASE_URL: preserve(),
      WIRE_PROGRAM_AUTO_APPLY: preserve(),
    },
  });
  return project("grants-dot-watch", {
    resources: [grantsDotWatch],
  });
});
