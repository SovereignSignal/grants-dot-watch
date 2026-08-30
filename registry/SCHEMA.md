# Registry file schemas

All files kebab-case, one entity per file, filename = `id` + extension. Facts only —
every claim must be traceable to a source the org itself published or a verified dataset.
NEVER include: relationship/CRM data, propensity or quality scores, BD notes, contacts.

## systems/<id>.yaml
```yaml
id: cardano                    # required, = filename
name: Cardano                  # required
kind: protocol-ecosystem       # required: protocol-ecosystem | funding-domain
part_of: []                    # optional: ids of enclosing systems
wires: [crypto]                # subset of: crypto, ai, oss
summary: >                     # required, 1 short paragraph, plain language
  ...
funding_channels: []           # optional: program ids that anchor the system
sources: []                    # urls
```

## orgs/<id>.yaml
```yaml
id: uniswap-foundation         # required, = filename
name: Uniswap Foundation       # required
aka: []                        # alias strings the resolver matches on
systems: []                    # system ids (must exist in systems/)
wires: [crypto]
roles: [funder]                # funder | grantee | ecosystem (one or more)
org_type: foundation           # foundation | dao | company | nonprofit | government | education
website: https://...
socials: {}                    # x, github, forum keys — urls
status: active                 # active | winding-down | dormant | unknown
profile: >                     # 2–4 sentences, public facts only
  ...
funding:                       # funders only; omit keys you can't source
  focus: []
  typical_size: ""
  cadence: ""
  apply_url: ""
sources: []                    # provenance urls
```

## programs/<id>.yaml
```yaml
id: uniswap-grants             # required, = filename; prefix with org when ambiguous
name: Uniswap Grants Program
org: uniswap-foundation        # required, must exist in orgs/
parent: null                   # program id for sub-programs
systems: []
wires: [crypto]
status: active                 # active | paused | concluded | announced | unknown
mechanism: grants              # grants | retro | quadratic | prize | fellowship | incubator | rfp | other
apply_url: ""
summary: >
  ...
rounds: []                     # list of {name, status, opens?, closes?, size?, source}
                               # round status: announced | open | reviewing | closed | deployed
                               # Record each remaining cutoff or receipt date as its own
                               # round. Do not store only the last date of a multi-window call.
                               # An undated open/announced round may not carry a past year
                               # in its name (use a current-year or rolling label, or close it).
                               # A concluded program must not keep apply_url — the call is over.
                               # Dated one-shot calls and named cohorts conclude after the
                               # application window closes, even if selection or funded work continues.
sources: []
```

## awards/<year>.jsonl
One JSON object per line:
`{"funder","funder_name","grantee","grantee_name","amount","currency","amount_text","date","program","wire","source","key"}`
`funder`/`program` reference registry ids; `grantee` is a slug (may not have an org file).
Append-only; `key` is the dedupe key.
