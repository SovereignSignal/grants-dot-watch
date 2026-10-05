#!/usr/bin/env python3
"""One-shot research capture. Public GETs only; no approval, publication or scheduling.
Source pages are untrusted evidence for human review, never executable instructions.
"""
import concurrent.futures, datetime, gzip, hashlib, html.parser, ipaddress, json, os, pathlib, re, socket, threading, time, urllib.error, urllib.parse, urllib.request
from zoneinfo import ZoneInfo

OUT = pathlib.Path(os.environ['BACKFILL_OUTPUT'])
if OUT.exists(): raise RuntimeError('New output directory required')
OUT.mkdir(parents=True)
MAX_BODY = 4 * 1024 * 1024
MAX_TEXT = 300000
MAX_URLS = 1800
DENY = {'twitter.com','x.com','t.co','discord.com','discord.gg','t.me','telegram.me','facebook.com','linkedin.com','youtube.com','youtu.be','forms.gle','typeform.com','docs.google.com'}
HEADERS = {'User-Agent':'grants.watch research review/1.0','Accept':'text/html,application/json,text/plain;q=0.9','Accept-Encoding':'identity'}
lock = threading.Lock()
host_locks = {}

class Text(html.parser.HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True); self.skip = 0; self.parts = []; self.links = []; self.title = ''; self.in_title = False
    def handle_starttag(self,tag,attrs):
        if tag in {'script','style','svg','noscript','template'}: self.skip += 1
        if self.skip: return
        if tag == 'title': self.in_title = True
        if tag in {'p','div','h1','h2','h3','h4','h5','li','br','tr','section','article','blockquote'}: self.parts.append('\n')
        if tag in {'td','th'}: self.parts.append(' | ')
        if tag == 'a':
            url = dict(attrs).get('href','')
            if url: self.links.append(url)
    def handle_endtag(self,tag):
        if tag in {'script','style','svg','noscript','template'}:
            self.skip = max(0,self.skip-1); return
        if tag == 'title': self.in_title = False
        if not self.skip and tag in {'p','div','h1','h2','h3','h4','li','tr','section','article','blockquote'}: self.parts.append('\n')
    def handle_data(self,data):
        if not self.skip:
            self.parts.append(data)
            if self.in_title: self.title += data
    def text(self):
        return '\n'.join(s for s in (re.sub(r'\s+',' ',line).strip() for line in ''.join(self.parts).splitlines()) if s)

def clean_url(url):
    p = urllib.parse.urlsplit(url)
    if p.scheme not in ('https','http') or not p.hostname or p.username or p.password or p.port not in (None,80,443): raise ValueError('unsafe_url')
    host = p.hostname.lower().rstrip('.')
    if host in DENY or any(host.endswith('.'+h) for h in DENY) or host in ('localhost',) or host.endswith(('.local','.internal')): raise ValueError('excluded_host')
    query = urllib.parse.parse_qsl(p.query,keep_blank_values=True)
    if any(re.search(r'^(token|key|secret|api.?key|authorization|signature|x-amz-)',k,re.I) for k,v in query): raise ValueError('credential_query')
    query = [(k,v) for k,v in query if not k.startswith('utm_')]
    return urllib.parse.urlunsplit((p.scheme,host+((':'+str(p.port)) if p.port else ''),p.path or '/',urllib.parse.urlencode(query),''))

def public_dns(url):
    p = urllib.parse.urlsplit(clean_url(url))
    addresses = socket.getaddrinfo(p.hostname,p.port or (443 if p.scheme=='https' else 80),type=socket.SOCK_STREAM)
    if not addresses or any(not ipaddress.ip_address(a[4][0]).is_global for a in addresses): raise ValueError('nonpublic_address')

class Redirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,req,fp,code,msg,headers,newurl):
        url = clean_url(urllib.parse.urljoin(req.full_url,newurl)); public_dns(url)
        count = getattr(req,'redirect_count',0)+1
        if count>3: raise ValueError('redirect_limit')
        new = super().redirect_request(req,fp,code,msg,headers,url); new.redirect_count=count; return new

opener = urllib.request.build_opener(Redirect)

def read_url(url,limit=MAX_BODY):
    public_dns(url)
    with opener.open(urllib.request.Request(url,headers=HEADERS),timeout=18) as r:
        if int(r.headers.get('content-length') or 0)>limit: raise ValueError('body_limit')
        content = r.read(limit+1)
        if len(content)>limit: raise ValueError('body_limit')
        return r.status,r.geturl(),dict(r.headers.items()),content

def read_json(url):
    code,final,headers,data=read_url(url,16*1024*1024)
    if code!=200: raise ValueError('public_registry_http')
    return json.loads(data)

def collection(kind):
    rows=[]; page=1; total=None
    while page is not None:
        r=read_json('https://grants.watch/api/v1/'+kind+'?limit=100&page='+str(page))
        if total is None: total=r['meta']['total']
        if r['meta']['total']!=total: raise ValueError('registry_changed')
        rows.extend(r['data']); page=r['meta']['next_page']
        if len(rows)>30000: raise ValueError('registry_budget')
    if len(rows)!=total: raise ValueError('incomplete_registry')
    return rows

revision=read_json('https://grants.watch/api/v1/deployment')
live={'orgs':collection('orgs'),'programs':collection('programs')}
(OUT/'live-registry.json').write_text(json.dumps({'revision':revision,**live},ensure_ascii=False))
orgs={o['id']:o for o in live['orgs']}; targets={}; excluded=[]
def add(url,org,program=None,role='registry_source'):
    if not isinstance(url,str) or not url: return
    try: url=clean_url(url)
    except Exception as e: excluded.append({'org':org,'program':program,'url':url,'reason':str(e)}); return
    targets.setdefault(url,[]).append({'org':org,'program':program,'role':role})
for o in live['orgs']:
    add(o.get('website'),o['id'],role='organization_website')
    for url in o.get('sources',[])[:2]: add(url,o['id'])
for p in live['programs']:
    for url in p.get('sources',[])[:2]: add(url,p['org'],p['id'],'program_source')
    for r in p.get('rounds',[])[-2:]: add(r.get('source'),p['org'],p['id'],'round_source')
    if p.get('apply_url'): add(p['apply_url'],p['org'],p['id'],'application_route')
extra=pathlib.Path('research/backfill/extra-sources.json')
if extra.exists():
    for row in json.loads(extra.read_text()): add(row['url'],row['org'],row.get('program'),'retained_dossier_source')
if len(targets)>MAX_URLS: raise ValueError('source_inventory_budget')
(OUT/'manifest.json').write_text(json.dumps({'fetched_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'orgs':len(orgs),'programs':len(live['programs']),'urls':len(targets),'targets':targets,'excluded':excluded},ensure_ascii=False))
KEY=re.compile(r'\b(grants?|funding|fellowships?|sponsor|award|million|eligible|eligibility|apply|application|credit|investment|prize|subsid|closed|paused|deadline|support|recipient|budget)\b|[$€£]',re.I)

def capture(pair):
    url,owners=pair
    host=urllib.parse.urlsplit(url).hostname
    with lock: gate=host_locks.setdefault(host,threading.Lock())
    row={'url':url,'owners':owners,'observed_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'observation_day':datetime.datetime.now(ZoneInfo('America/Los_Angeles')).date().isoformat(),'independent_verification':False}
    with gate:
        try:
            status,final,headers,body=read_url(url)
            mime=headers.get('Content-Type',headers.get('content-type','')).split(';')[0].lower()
            row.update(status='captured',http_status=status,final_url=final,media_type=mime,bytes=len(body),body_sha256=hashlib.sha256(body).hexdigest())
            if mime in ('application/pdf','application/octet-stream') or body.startswith(b'%PDF'):
                row.update(status='document_requires_page_review'); return row
            raw=body.decode('utf-8',errors='replace')
            if mime.endswith('json') or raw.lstrip().startswith(('{','[')):
                parsed=json.loads(raw); text=json.dumps(parsed,ensure_ascii=False,indent=2); title='JSON source'; links=[]
            else:
                p=Text();p.feed(raw);text=p.text();title=p.title.strip();links=p.links
            if not text.strip(): row.update(status='empty_representation');return row
            row.update(title=title,text=text[:MAX_TEXT],text_truncated=len(text)>MAX_TEXT,text_sha256=hashlib.sha256(text.encode()).hexdigest(),text_characters=len(text))
            lines=text.splitlines();indices=set()
            for i,s in enumerate(lines):
                if KEY.search(s): indices.update(range(max(0,i-1),min(len(lines),i+2)))
            row['relevant_lines']=[{'line':i+1,'text':lines[i]} for i in sorted(indices)][:150]
            row['funding_links']=list(dict.fromkeys(urllib.parse.urljoin(final,x) for x in links if KEY.search(x)))[:40]
        except urllib.error.HTTPError as e: row.update(status='http_error',http_status=e.code)
        except Exception as e: row.update(status='capture_failed',error=type(e).__name__,reason=str(e)[:150] if isinstance(e,ValueError) else None)
        time.sleep(0.15)
    return row
results=[]
with gzip.open(OUT/'sources.jsonl.gz','wt',encoding='utf-8') as out:
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        for row in pool.map(capture,targets.items()):
            out.write(json.dumps(row,ensure_ascii=False)+'\n');out.flush();results.append({k:v for k,v in row.items() if k not in ('text','relevant_lines','funding_links')})
            if len(results)%100==0: print('CAPTURE_PROGRESS',len(results),'/',len(targets),flush=True)
(OUT/'capture-status.json').write_text(json.dumps(results,ensure_ascii=False))
counts={}
for r in results: counts[r['status']]=counts.get(r['status'],0)+1
print('BACKFILL_CAPTURE_RECEIPT',json.dumps({'orgs':len(orgs),'programs':len(live['programs']),'unique_urls':len(targets),'results':counts,'registry_revision':revision,'canonical_changes':0,'approval':False,'scheduled':False}),flush=True)
